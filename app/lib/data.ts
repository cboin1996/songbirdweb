export const API_HOST = process.env.NEXT_PUBLIC_API_HOST;
export const BASE_URL = `http://${API_HOST}:8000`;
export const DOWNLOAD_URL = `${BASE_URL}/download`;
export const TAGGING_URL = `${BASE_URL}/properties`;
export const ITUNES_SEARCH_URL = `${BASE_URL}/properties/itunes`;

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

export async function fetchData(args: {
  url: string;
  method: string;
  body?: any;
  validErrors?: number[];
  responseType?: ResponseTypes;
}): Promise<any> {
  try {
    const responseType = args.responseType ?? ResponseTypes.json;
    const validErrors = args.validErrors ?? [];
    const options = await buildFetchOptions(args.method, args.body);
    const response = await fetch(args.url, options);
    if (!response.ok || validErrors.includes(response.status)) {
      return undefined;
    }
    if (responseType === ResponseTypes.json) return response.json();
    if (responseType === ResponseTypes.bytes) return response.bytes();
    if (responseType === ResponseTypes.blob) return response.blob();
  } catch (error) {
    console.error("Fetch error:", error);
    return undefined;
  }
}

export interface CurrentUser {
  username: string;
  role: string;
}

export async function login(username: string, password: string): Promise<CurrentUser | undefined> {
  try {
    const response = await fetch(`${BASE_URL}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username, password }),
      credentials: 'include',
    });
    if (!response.ok) return undefined;
    return response.json();
  } catch (error) {
    console.error("Login error:", error);
    return undefined;
  }
}

export async function logout(): Promise<void> {
  try {
    await fetch(`${BASE_URL}/auth/logout`, {
      method: 'POST',
      credentials: 'include',
    });
  } catch (error) {
    console.error("Logout error:", error);
  }
}

export interface DownloadedSong {
  songId?: string;
  properties: Properties;
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
}

export async function downloadSongViaUrl(
  url: string,
  embedThumbnail: boolean = false,
): Promise<DownloadedSongIds> {
  const songs: DownloadedSongIds = await fetchData({
    url: DOWNLOAD_URL,
    method: "POST",
    body: {
      url: url,
      embed_thumbnail: embedThumbnail,
    },
  });
  return songs;
}

export async function fetchPropertiesViaUrl(
  url: string,
): Promise<DownloadedSong[]> {
  const songs: DownloadedSongIds = await downloadSongViaUrl(url);
  if (songs === undefined) {
    return [];
  }
  const props: DownloadedSong[] = [];
  for (let songId of songs.song_ids) {
    const properties: Properties | undefined = await fetchData({
      url: `${TAGGING_URL}/${songId}`,
      method: "GET",
      validErrors: [404],
    });
    if (properties !== undefined) {
      props.push({
        songId: songId,
        properties: properties,
      });
    }
  }
  return props;
}

export async function fetchSong(id: string): Promise<Blob> {
  const result: Blob = await fetchData({
    url: `${DOWNLOAD_URL}/${id}`,
    method: "GET",
    responseType: ResponseTypes.blob,
  });
  return result;
}

export async function fetchPropertiesFromItunes(
  query: string,
  lookup: boolean = false,
  limit: number = 10
): Promise<DownloadedSong[] | undefined> {
  const params = new URLSearchParams({
    query: query,
    lookup: lookup.toString(),
    limit: limit.toString()
  });
  const result: Properties[] = await fetchData({
    url: `${ITUNES_SEARCH_URL}?${params.toString()}`,
    method: "GET",
  });
  if (result === undefined) return;
  return result.map(properties => ({ properties }));
}

export async function fetchAlbumFromItunes(
  query: string,
  lookup: boolean = false,
): Promise<AlbumProps[]> {
  const params = new URLSearchParams({
    query: query,
    lookup: lookup.toString(),
    mode: "album"
  });
  const result: AlbumProps[] = await fetchData({
    url: `${ITUNES_SEARCH_URL}?${params.toString()}`,
    method: "GET",
  });
  return result;
}

interface IndexedProperties {
  uuid: string;
  properties: Properties;
  file_path: string;
  url: string;
}

export async function fetchPropertiesFromIndex(
  query: string,
): Promise<DownloadedSong[] | undefined> {
  const params = new URLSearchParams({ query });
  const result: IndexedProperties[] = await fetchData({
    url: `${TAGGING_URL}?${params.toString()}`,
    method: "GET",
  });
  if (result === undefined) return;
  return result.map(song => ({ songId: song.uuid, properties: song.properties }));
}

interface TaggingResponse {
  song_id: string;
}
interface TaggingBody {
  properties: Properties;
  song_id: string;
}
export async function tagSong(
  songId: string,
  properties: Properties,
): Promise<TaggingResponse> {
  const body: TaggingBody = { properties, song_id: songId };
  const result: TaggingResponse = await fetchData({
    url: `${TAGGING_URL}`,
    method: "PUT",
    body: body,
  });
  return result;
}
