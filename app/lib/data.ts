import { cacheLibraryData, getCachedData } from './offline-db'
import { EVENTS } from './events'

const isServer = typeof window === 'undefined'
export const BASE_URL = isServer
  ? (process.env.API_BASE_URL ?? 'http://localhost:8000')
  : (process.env.NEXT_PUBLIC_API_BASE_URL ?? '');
export const API_V1 = `${BASE_URL}/v1`;
export const API_V1_PATH = '/v1';
export const DOWNLOAD_URL = `${API_V1}/download`;
export const TAGGING_URL = `${API_V1}/properties`;
export const ITUNES_SEARCH_URL = `${API_V1}/properties/itunes`;

export function isValidUrl(url: string) {
  try {
    return Boolean(new URL(url));
  } catch (e) {
    return false;
  }
}

enum ResponseTypes {
  json,
  bytes,
  blob,
}

const SKIP_REFRESH_URLS = new Set([
  `${API_V1}/auth/login`,
  `${API_V1}/auth/refresh`,
  `${API_V1}/auth/me`,
])

let refreshPromise: Promise<boolean> | null = null

function redirectToLogin() {
  if (window.location.pathname === '/') return
  window.location.href = '/?next=' + encodeURIComponent(window.location.pathname + window.location.search)
}

async function tryRefresh(): Promise<boolean> {
  if (refreshPromise) return refreshPromise
  refreshPromise = fetch(`${API_V1}/auth/refresh`, { method: 'POST', credentials: 'include' })
    .then(r => r.ok)
    .catch(() => false)
    .finally(() => { refreshPromise = null })
  return refreshPromise
}

async function buildFetchOptions(method: string, body?: any): Promise<RequestInit> {
  const isServer = typeof window === 'undefined';
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };

  if (isServer) {
    const { cookies } = await import('next/headers');
    const cookieStore = await cookies();
    const cookieHeader = cookieStore.getAll().map(c => `${c.name}=${c.value}`).join('; ');
    if (cookieHeader) headers['Cookie'] = cookieHeader;
  }

  const options: RequestInit = { method, headers };
  if (!isServer) options.credentials = 'include';
  if (body !== undefined) options.body = JSON.stringify(body);
  return options;
}

async function fetchData<T>(args: {
  url: string;
  method: string;
  body?: any;
  responseType?: ResponseTypes;
  silentStatuses?: number[];
}): Promise<T | undefined> {
  try {
    const responseType = args.responseType ?? ResponseTypes.json;
    const options = await buildFetchOptions(args.method, args.body);
    const response = await fetch(args.url, options);
    if (!response.ok) {
      const silent = args.silentStatuses ?? []
      if (response.status === 401 && typeof window !== 'undefined' && !SKIP_REFRESH_URLS.has(args.url)) {
        const refreshed = await tryRefresh()
        if (refreshed) {
          const retryOptions = await buildFetchOptions(args.method, args.body)
          const retryResponse = await fetch(args.url, retryOptions)
          if (retryResponse.ok) {
            if (responseType === ResponseTypes.json) return await retryResponse.json() as T;
            if (responseType === ResponseTypes.bytes) return await retryResponse.bytes() as T;
            if (responseType === ResponseTypes.blob) return await retryResponse.blob() as T;
          }
        }
        redirectToLogin()
        return undefined;
      }
      if (response.status !== 401 && !silent.includes(response.status))
        console.error(`Fetch error: ${response.status} ${args.method} ${args.url}`)
      return undefined;
    }
    if (responseType === ResponseTypes.json) return response.json() as T;
    if (responseType === ResponseTypes.bytes) return response.bytes() as T;
    if (responseType === ResponseTypes.blob) return response.blob() as T;
  } catch (error) {
    if (!(error instanceof TypeError && error.message.includes('NetworkError'))) {
      console.error("Fetch error:", error)
    }
    return undefined;
  }
}

export interface CurrentUser {
  username: string;
  role: string;
}

export async function fetchCurrentUser(): Promise<CurrentUser | undefined> {
  return fetchData<CurrentUser>({ url: `${API_V1}/auth/me`, method: 'GET' })
}

export async function login(username: string, password: string): Promise<CurrentUser | 401 | 'error'> {
  try {
    const response = await fetch(`${API_V1}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      credentials: 'include',
    });
    if (response.status === 401) return 401;
    if (!response.ok) return 'error';
    return await response.json();
  } catch {
    return 'error';
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${API_V1}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  } catch (error) {
    console.error("Logout error:", error);
  }
}

export interface LibraryEntry {
  song_id: string
  added_at: string
  last_position: number
  last_played_at: string | null
}

export async function fetchLibrary(): Promise<LibraryEntry[]> {
  return await fetchData<LibraryEntry[]>({ url: `${API_V1}/library`, method: 'GET' }) ?? []
}

export interface PlayableSong {
  uuid: string
  properties: Properties
  last_position?: number
  last_played_at?: string | null
  artwork_cached?: boolean
  source?: { label: string; href: string; id: string } | null
}

export interface LibrarySong {
  uuid: string
  url: string
  properties: Properties | null
  artwork_cached: boolean
  parent_song_id: string | null
  root_song_id: string | null
  owner_id: string | null
  source?: string | null
  added_at: string
  last_position: number
  last_played_at: string | null
}

export interface DraftSummary {
  song_id: string
  properties: Properties | null
  artwork_cached: boolean
  updated_at: string
}

export interface DraftWithMeta {
  params: EditParams
  updated_at: string
}

export async function fetchDrafts(): Promise<DraftSummary[]> {
  return await fetchData<DraftSummary[]>({ url: `${API_V1}/edit/drafts`, method: 'GET' }) ?? []
}


export async function fetchLibrarySongs(): Promise<LibrarySong[]> {
  const result = await fetchData<LibrarySong[]>({ url: `${API_V1}/songs/library`, method: 'GET' })
  if (result !== undefined) {
    if (typeof window !== 'undefined') cacheLibraryData('library-songs', result)
    return result
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return await getCachedData<LibrarySong[]>('library-songs') ?? []
  }
  return []
}

export async function fetchSongById(id: string): Promise<PlayableSong | undefined> {
  const raw = await fetchData<SongLike>({ url: `${API_V1}/songs/${id}`, method: 'GET', silentStatuses: [404] })
  return raw ? toPlayableSong(raw) : undefined
}

export async function fetchAllSongs(): Promise<LibrarySong[]> {
  return await fetchData<LibrarySong[]>({ url: `${API_V1}/songs`, method: 'GET' }) ?? []
}

export type ExploreWindow = 'day' | 'week' | 'all'

export interface SongWithCount {
  uuid: string
  properties: Properties | null
  count: number
  source?: string | null
  artwork_cached?: boolean
}

export interface RecentlyPlayedSong {
  uuid: string
  properties: Properties | null
  last_played_at: string
  artwork_cached?: boolean
}

export interface RecentlySavedSong {
  uuid: string
  properties: Properties | null
  added_at: string
  artwork_cached?: boolean
}

export interface ExploreData {
  most_played: SongWithCount[]
  most_downloaded: SongWithCount[]
  most_libraryed: SongWithCount[]
  recently_added: { uuid: string; url: string; properties: Properties | null; added_at: string; source?: string | null; artwork_cached?: boolean }[]
  your_most_played: SongWithCount[]
  your_most_downloaded: SongWithCount[]
  your_recently_saved: RecentlySavedSong[]
  your_recently_played: RecentlyPlayedSong[]
}

export async function fetchExplore(window: ExploreWindow = 'week'): Promise<ExploreData | undefined> {
  return fetchData<ExploreData>({ url: `${API_V1}/songs/explore?window=${window}`, method: 'GET' })
}

export async function recordPlay(songId: string): Promise<void> {
  try {
    const options = await buildFetchOptions('POST')
    await fetch(`${API_V1}/songs/${songId}/play`, options)
  } catch {}
}

export async function addToLibrary(songId: string): Promise<boolean> {
  const result = await fetchData<LibraryEntry>({ url: `${API_V1}/library/${songId}`, method: 'POST' })
  return result !== undefined
}

export async function removeFromLibrary(songId: string): Promise<boolean> {
  try {
    const options = await buildFetchOptions('DELETE')
    const response = await fetch(`${API_V1}/library/${songId}`, options)
    return response.ok
  } catch {
    return false
  }
}

export async function bulkRemoveFromLibrary(songIds: string[]): Promise<boolean> {
  try {
    const options = await buildFetchOptions('DELETE', { song_ids: songIds })
    const response = await fetch(`${API_V1}/library/bulk`, options)
    return response.ok
  } catch {
    return false
  }
}

export interface DownloadedSong {
  songId?: string;
  properties: Properties;
  artworkCached?: boolean;
  parentSongId?: string | null;
  rootSongId?: string | null;
  source?: string | null;
  owner_id?: string | null;
}

type SongLike = {
  uuid?: string
  songId?: string
  properties?: Properties | null
  artwork_cached?: boolean
  artworkCached?: boolean
  source?: string | null
  owner_id?: string | null
  parent_song_id?: string | null
  parentSongId?: string | null
  root_song_id?: string | null
  rootSongId?: string | null
  last_position?: number
  last_played_at?: string | null
}

export function toSongCard(raw: SongLike): DownloadedSong {
  return {
    songId: raw.uuid ?? raw.songId,
    properties: raw.properties!,
    artworkCached: raw.artwork_cached ?? raw.artworkCached,
    source: raw.source,
    owner_id: raw.owner_id,
    parentSongId: raw.parent_song_id ?? raw.parentSongId,
    rootSongId: raw.root_song_id ?? raw.rootSongId,
  }
}

export function toPlayableSong(raw: SongLike, source?: { label: string; href: string; id: string } | null): PlayableSong {
  return {
    uuid: (raw.uuid ?? raw.songId)!,
    properties: raw.properties!,
    artwork_cached: raw.artwork_cached ?? raw.artworkCached,
    last_position: raw.last_position,
    last_played_at: raw.last_played_at,
    source: source ?? null,
  }
}

export function artworkUrl(url: string, size: number): string {
  return url.replace(/\d+x\d+bb/, `${size}x${size}bb`)
}

export function songArtworkUrl(songId: string | undefined, artworkCached: boolean | undefined, artworkUrl100: string | undefined, size: number): string | null {
  if (songId && artworkCached) {
    const sizeParam = size <= 300 ? 'thumb' : 'full'
    return `${API_V1_PATH}/songs/${songId}/artwork/${sizeParam}`
  }
  return artworkUrl100 ? artworkUrl(artworkUrl100, size) : null
}

export interface Properties {
  trackName: string;
  artistName: string;
  collectionName: string;
  artworkUrl100: string;
  primaryGenreName: string;
  trackNumber: number;
  trackCount: number;
  collectionId: string;
  collectionArtistName?: string;
  discNumber: number;
  discCount: number;
  releaseDate: string;
  releaseDateKey: string;
}

export interface AlbumProps {
    artistName: string,
    collectionName: string,
    trackCount: number,
    collectionId: number
}

interface DownloadedSongIds {
  song_ids: string[];
  cached: boolean;
  properties?: Properties | null;
  artwork_cached?: boolean;
}

export async function downloadSongViaUrl(
  url: string,
  embedThumbnail: boolean = false,
): Promise<DownloadedSongIds | undefined> {
  return fetchData<DownloadedSongIds>({
    url: DOWNLOAD_URL,
    method: "POST",
    body: { url, embed_thumbnail: embedThumbnail },
  });
}

export async function fetchSong(id: string): Promise<Blob | undefined> {
  return fetchData<Blob>({
    url: `${DOWNLOAD_URL}/${id}`,
    method: "GET",
    responseType: ResponseTypes.blob,
  });
}

export async function downloadSongToFile(songId: string, trackName: string, artistName: string): Promise<boolean> {
  const blob = await fetchSong(songId)
  if (!blob) return false
  const url = window.URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = `${trackName} - ${artistName}.mp3`
  document.body.appendChild(link)
  link.click()
  document.body.removeChild(link)
  window.URL.revokeObjectURL(url)
  return true
}

export async function fetchPropertiesFromItunes(
  query: string,
  lookup: boolean = false,
  limit: number = 10
): Promise<DownloadedSong[] | undefined> {
  const params = new URLSearchParams({ query, lookup: lookup.toString(), limit: limit.toString() });
  const result = await fetchData<Properties[]>({
    url: `${ITUNES_SEARCH_URL}?${params.toString()}`,
    method: "GET",
  });
  if (result === undefined) return undefined;
  return result.map(properties => ({ properties }));
}

export async function fetchAlbumFromItunes(
  query: string,
  lookup: boolean = false,
): Promise<AlbumProps[] | undefined> {
  const params = new URLSearchParams({ query, lookup: lookup.toString(), mode: "album" });
  return fetchData<AlbumProps[]>({
    url: `${ITUNES_SEARCH_URL}?${params.toString()}`,
    method: "GET",
  });
}

interface IndexedProperties {
  uuid: string;
  properties: Properties;
  file_path: string;
  url: string;
  owner_id: string | null;
  source: string | null;
  artwork_cached: boolean;
}

export async function fetchPropertiesFromIndex(
  query: string,
): Promise<DownloadedSong[] | undefined> {
  const params = new URLSearchParams({ query });
  const result = await fetchData<IndexedProperties[]>({
    url: `${TAGGING_URL}?${params.toString()}`,
    method: "GET",
  });
  if (result === undefined) return undefined;
  return result.map(song => ({ songId: song.uuid, properties: song.properties, owner_id: song.owner_id, source: song.source, artworkCached: song.artwork_cached }));
}

interface TaggingResponse {
  song_id: string;
}

export interface UserInfo {
  id: string
  username: string
  email: string
  role: string
  is_active: boolean
  created_at: string
}

export async function fetchUsers(): Promise<UserInfo[]> {
  return await fetchData<UserInfo[]>({ url: `${API_V1}/admin/users`, method: 'GET' }) ?? []
}

export async function updateUser(id: string, body: { role?: string; is_active?: boolean }): Promise<UserInfo | undefined> {
  return fetchData<UserInfo>({ url: `${API_V1}/admin/users/${id}`, method: 'PATCH', body })
}

export async function deleteUser(id: string): Promise<boolean> {
  try {
    const options = await buildFetchOptions('DELETE')
    const response = await fetch(`${API_V1}/admin/users/${id}`, options)
    return response.ok
  } catch {
    return false
  }
}

export interface EditJobSummary {
  job_id: string
  source_song_id: string
  user_id: string
  status: string
  result_song_id: string | null
  error: string | null
  created_at: string
  updated_at: string
}

export interface DayActivity {
  date: string
  plays: number
  downloads: number
}

export interface TopSong {
  song_id: string
  title: string | null
  artist: string | null
  count: number
}

export interface PerUser {
  user_id: string
  username: string
  song_count: number
  play_count: number
  download_count: number
  last_active: string | null
}

export interface AdminStats {
  song_count: number
  user_count: number
  disk_bytes: number
  disk_total: number
  disk_free: number
  failed_job_count: number
  active_share_tokens: number
  import_count: number
  import_failed_count: number
  import_duplicate_count: number
  recent_jobs: EditJobSummary[]
  plays_by_day: DayActivity[]
  top_songs: TopSong[]
  per_user: PerUser[]
}

export async function fetchAdminStats(): Promise<AdminStats | undefined> {
  return fetchData<AdminStats>({ url: `${API_V1}/admin/stats`, method: 'GET' })
}

export interface EditJobsPage {
  total: number
  jobs: EditJobSummary[]
}

export async function fetchAdminEditJobs(limit = 20, offset = 0): Promise<EditJobsPage> {
  return await fetchData<EditJobsPage>({ url: `${API_V1}/admin/edit-jobs?limit=${limit}&offset=${offset}`, method: 'GET' }) ?? { total: 0, jobs: [] }
}

export interface ErrorLogEntry {
  id: string
  timestamp: string
  level: string
  path: string | null
  method: string | null
  status_code: number | null
  message: string
  detail: string | null
  user_id: string | null
}

export interface ErrorsPage {
  total: number
  errors: ErrorLogEntry[]
}

export async function fetchAdminErrors(limit = 50, offset = 0): Promise<ErrorsPage> {
  return await fetchData<ErrorsPage>({ url: `${API_V1}/admin/errors?limit=${limit}&offset=${offset}`, method: 'GET' }) ?? { total: 0, errors: [] }
}

export interface PlayerState {
  shuffle: boolean
  repeat: 'off' | 'one' | 'all'
  queue: string[]
  queue_index: number
  shuffle_order?: number[] | null
  play_context?: string | null
  shuffle_seed?: number | null
  shuffle_position?: number
  manual_next?: string[]
  current_song_uuid?: string | null
  queue_sources?: Record<string, { id: string; label: string; href: string }>
  updated_at?: string | null
}

export async function fetchPlayerState(): Promise<PlayerState | undefined> {
  return fetchData<PlayerState>({ url: `${API_V1}/player/state`, method: 'GET' })
}

export async function savePlayerState(state: PlayerState): Promise<void> {
  try {
    const options = await buildFetchOptions('PUT', state)
    await fetch(`${API_V1}/player/state`, options)
  } catch {}
}

export async function updatePosition(songId: string, position: number): Promise<boolean> {
  try {
    const options = await buildFetchOptions('PATCH', { position })
    const response = await fetch(`${API_V1}/library/${songId}/position`, options)
    return response.ok
  } catch {
    return false
  }
}

export async function registerUser(username: string, email: string, password: string): Promise<UserInfo | undefined> {
  return fetchData<UserInfo>({ url: `${API_V1}/auth/register`, method: 'POST', body: { username, email, password } })
}

export interface VersionInfo {
  api_version: string
  core_version: string
}

export async function fetchVersion(): Promise<VersionInfo | undefined> {
  return fetchData<VersionInfo>({ url: `${API_V1}/version`, method: 'GET' })
}

export interface ShareToken {
  token: string
  expires_at: string
}

export interface ShareInfo {
  token: string
  expires_at: string
  song_id: string
  properties: Properties | null
}

export async function createShareToken(songId: string): Promise<ShareToken | undefined> {
  return fetchData<ShareToken>({ url: `${API_V1}/share/songs/${songId}`, method: 'POST' })
}

export async function fetchShareInfo(token: string): Promise<ShareInfo | undefined> {
  try {
    const res = await fetch(`${API_V1}/share/${token}/info`)
    if (!res.ok) return undefined
    return res.json()
  } catch {
    return undefined
  }
}

export interface ImportJobResult {
  job_id: string
  status: string
  song_id?: string
  track_name?: string
  error?: string
  duplicate_of?: string
  filename?: string
  created_at?: string
}

export async function startImport(file: File, asOriginal = false): Promise<ImportJobResult | undefined> {
  try {
    const formData = new FormData()
    formData.append('file', file)
    const url = asOriginal ? `${API_V1}/import?as_original=true` : `${API_V1}/import`
    const response = await fetch(url, { method: 'POST', body: formData, credentials: 'include' })
    if (!response.ok) return undefined
    return response.json()
  } catch {
    return undefined
  }
}

export interface ImportJobsPage {
  total: number
  jobs: ImportJobResult[]
  status_counts?: Record<string, number>
}

export async function listImportJobs(limit = 20, offset = 0): Promise<ImportJobsPage> {
  return await fetchData<ImportJobsPage>({ url: `${API_V1}/import?limit=${limit}&offset=${offset}`, method: 'GET' }) ?? { total: 0, jobs: [], status_counts: {} }
}

export async function pollImportJob(jobId: string): Promise<ImportJobResult | undefined> {
  try {
    const response = await fetch(`${API_V1}/import/${jobId}`, { credentials: 'include' })
    if (!response.ok) return undefined
    return response.json()
  } catch {
    return undefined
  }
}

export async function changePassword(currentPassword: string, newPassword: string): Promise<boolean> {
  try {
    const options = await buildFetchOptions('PATCH', { current_password: currentPassword, new_password: newPassword })
    const response = await fetch(`${API_V1}/auth/password`, options)
    return response.ok
  } catch {
    return false
  }
}

export async function tagSong(
  songId: string,
  properties: Properties,
  asOriginal = false,
): Promise<TaggingResponse | undefined> {
  return fetchData<TaggingResponse>({
    url: `${TAGGING_URL}`,
    method: "PUT",
    body: { properties, song_id: songId, as_original: asOriginal },
  });
}

export interface Cut {
  id?: string  // client-side only, stripped before API calls
  start: number
  end: number
  fade_in: number
  fade_out: number
}

export interface FadeEdit {
  id?: string  // client-side only
  start: number
  end: number
  type: 'in' | 'out'
}

export interface EditParams {
  trim_start: number
  trim_end: number | null
  volume: number
  fades: FadeEdit[]
  speed: number
  normalize: boolean
  cuts: Cut[]
  properties_overrides?: Properties | null
}

export interface EditJobResponse {
  job_id: string
  status: 'pending' | 'processing' | 'done' | 'failed'
  result_song_id: string | null
  error: string | null
}

export async function createEditJob(
  songId: string,
  params: EditParams,
  overwrite = false,
  asOriginal = false,
): Promise<EditJobResponse | undefined> {
  return fetchData<EditJobResponse>({
    url: `${API_V1}/edit/songs/${songId}`,
    method: 'POST',
    body: { params, overwrite, as_original: asOriginal },
  })
}

export async function pollEditJob(jobId: string): Promise<EditJobResponse | undefined> {
  return fetchData<EditJobResponse>({ url: `${API_V1}/edit/jobs/${jobId}`, method: 'GET' })
}

export async function fetchEditDraft(songId: string): Promise<DraftWithMeta | undefined> {
  return fetchData<DraftWithMeta>({ url: `${API_V1}/edit/songs/${songId}/draft`, method: 'GET', silentStatuses: [404] })
}

export async function saveEditDraft(songId: string, params: EditParams): Promise<void> {
  try {
    const options = await buildFetchOptions('PUT', params)
    await fetch(`${API_V1}/edit/songs/${songId}/draft`, options)
    window.dispatchEvent(new CustomEvent(EVENTS.draftChanged))
  } catch {}
}

export async function deleteEditDraft(songId: string): Promise<void> {
  try {
    const options = await buildFetchOptions('DELETE')
    await fetch(`${API_V1}/edit/songs/${songId}/draft`, options)
    window.dispatchEvent(new CustomEvent(EVENTS.draftChanged))
  } catch {}
}

export interface Playlist {
  id: string
  name: string
  icon?: string | null
  created_at: string
  updated_at: string
  song_count: number
}

export interface PlaylistSong {
  uuid: string
  url: string
  properties: Properties | null
  artwork_cached: boolean
  owner_id: string | null
}

export async function fetchPlaylists(): Promise<Playlist[]> {
  const result = await fetchData<Playlist[]>({ url: `${API_V1}/playlists`, method: 'GET' })
  if (result !== undefined) {
    if (typeof window !== 'undefined') cacheLibraryData('playlists', result)
    return result
  }
  if (typeof navigator !== 'undefined' && !navigator.onLine) {
    return await getCachedData<Playlist[]>('playlists') ?? []
  }
  return []
}

export async function createPlaylist(name: string, icon?: string | null): Promise<Playlist | undefined> {
  return fetchData<Playlist>({ url: `${API_V1}/playlists`, method: 'POST', body: { name, icon } })
}

export async function renamePlaylist(id: string, name: string, icon?: string | null): Promise<Playlist | undefined> {
  return fetchData<Playlist>({ url: `${API_V1}/playlists/${id}`, method: 'PATCH', body: { name, icon } })
}

export async function deletePlaylist(id: string): Promise<boolean> {
  try {
    const options = await buildFetchOptions('DELETE')
    const response = await fetch(`${API_V1}/playlists/${id}`, options)
    return response.ok
  } catch { return false }
}

export async function fetchPlaylistSongs(id: string): Promise<PlaylistSong[]> {
  const result = await fetchData<PlaylistSong[]>({ url: `${API_V1}/playlists/${id}/songs`, method: 'GET' })
  if (result !== undefined) {
    if (typeof window !== 'undefined') cacheLibraryData(`playlist-songs:${id}`, result)
    return result
  }
  return await getCachedData<PlaylistSong[]>(`playlist-songs:${id}`) ?? []
}

export async function addSongToPlaylist(playlistId: string, songUuid: string): Promise<boolean | 'duplicate'> {
  try {
    const options = await buildFetchOptions('POST', { song_uuid: songUuid })
    const response = await fetch(`${API_V1}/playlists/${playlistId}/songs`, options)
    if (response.status === 409) return 'duplicate'
    return response.ok
  } catch { return false }
}

export async function bulkAddSongsToPlaylist(playlistId: string, songUuids: string[]): Promise<boolean> {
  try {
    const options = await buildFetchOptions('POST', { song_uuids: songUuids })
    const response = await fetch(`${API_V1}/playlists/${playlistId}/songs/bulk`, options)
    return response.ok
  } catch { return false }
}

export async function removeSongFromPlaylist(playlistId: string, songUuid: string): Promise<boolean> {
  try {
    const options = await buildFetchOptions('DELETE')
    const response = await fetch(`${API_V1}/playlists/${playlistId}/songs/${songUuid}`, options)
    return response.ok
  } catch { return false }
}

export async function bulkRemoveSongsFromPlaylist(playlistId: string, songUuids: string[]): Promise<boolean> {
  try {
    const options = await buildFetchOptions('DELETE', { song_uuids: songUuids })
    const response = await fetch(`${API_V1}/playlists/${playlistId}/songs/bulk`, options)
    return response.ok
  } catch { return false }
}

export async function reorderPlaylistSongs(playlistId: string, songUuids: string[]): Promise<boolean> {
  try {
    const options = await buildFetchOptions('PATCH', { song_uuids: songUuids })
    const response = await fetch(`${API_V1}/playlists/${playlistId}/songs`, options)
    return response.ok
  } catch { return false }
}

export async function fetchServerOfflineSongs(): Promise<string[]> {
  return await fetchData<string[]>({ url: `${API_V1}/library/offline`, method: 'GET' }) ?? []
}

export async function syncOfflineSongs(localIds: string[]): Promise<string[]> {
  const result = await fetchData<{ server_only: string[] }>({
    url: `${API_V1}/library/offline/sync`,
    method: 'POST',
    body: { song_ids: localIds },
  })
  return result?.server_only ?? []
}

export async function addServerOfflineSong(songId: string): Promise<void> {
  try {
    const options = await buildFetchOptions('POST')
    await fetch(`${API_V1}/library/offline/${songId}`, options)
  } catch {}
}

export async function removeServerOfflineSong(songId: string): Promise<void> {
  try {
    const options = await buildFetchOptions('DELETE')
    await fetch(`${API_V1}/library/offline/${songId}`, options)
  } catch {}
}

export async function clearServerOfflineSongs(): Promise<void> {
  try {
    const options = await buildFetchOptions('DELETE')
    await fetch(`${API_V1}/library/offline`, options)
  } catch (e) {
    console.error('clearServerOfflineSongs:', e)
  }
}

export interface EligibleSong {
  uuid: string
  properties: Properties | null
  eligible: boolean
  missing_fields: string[]
  artwork_cached: boolean
}

export async function fetchEligibleSongs(): Promise<EligibleSong[]> {
  return await fetchData<EligibleSong[]>({ url: `${API_V1}/library/eligible`, method: 'GET' }) ?? []
}

export interface SongEligibility {
  eligible: boolean
  missing_fields: string[]
}

export async function fetchSongEligibility(songId: string): Promise<SongEligibility | undefined> {
  return await fetchData<SongEligibility>({ url: `${API_V1}/properties/${songId}/eligible`, method: 'GET' })
}

export async function publishSongs(songIds: string[]): Promise<number> {
  const result = await fetchData<{ published: number }>({ url: `${API_V1}/library/publish`, method: 'POST', body: { song_ids: songIds } })
  return result?.published ?? 0
}

export async function uploadSongArtwork(songId: string, file: File): Promise<boolean> {
  try {
    const formData = new FormData()
    formData.append('file', file)
    const response = await fetch(`${API_V1}/songs/${songId}/artwork`, {
      method: 'POST',
      body: formData,
      credentials: 'include',
    })
    return response.ok
  } catch { return false }
}
