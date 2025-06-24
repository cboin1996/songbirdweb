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
export async function fetchData(args: {
  url: string;
  method: string;
  body?: any;
  headers?: any;
  validErrors?: number[];
  responseType?: ResponseTypes;
}): Promise<any> {
  try {
    const responseType =
      args.responseType === undefined ? ResponseTypes.json : args.responseType;
    if (!args.validErrors) {
      args.validErrors = [];
    }
    const response = await fetch(args.url, {
      method: args.method,
      headers: args.headers,
      body: JSON.stringify(args.body),
    });
    if (!response.ok || args.validErrors.includes(response.status)) {
      return undefined;
    }
    let data: any = {};
    if (responseType === ResponseTypes.json) {
      data = await response.json();
    }
    if (responseType === ResponseTypes.bytes) {
      data = await response.bytes();
    }
    if (responseType === ResponseTypes.blob) {
      data = await response.blob();
    }
    return data;
  } catch (error) {
    console.error("Fetch error:", error);
    return undefined;
  }
}

// Usage:
interface User {
  id: number;
  name: string;
  email: string;
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
  apiKey: string,
  embedThumbnail: boolean = false,
): Promise<DownloadedSongIds> {
  const headers = {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
  };
  // get song_ids for a given url
  const songs: DownloadedSongIds = await fetchData({
    url: DOWNLOAD_URL,
    method: "POST",
    body: {
      url: url,
      embed_thumbnail: embedThumbnail,
    },
    headers: headers,
  });
  return songs;
}

export async function fetchPropertiesViaUrl(
  url: string,
  apiKey: string,
): Promise<DownloadedSong[]> {
  const headers = {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
  };
  // get song uuid for download if it exists
  const songs: DownloadedSongIds = await downloadSongViaUrl(url, apiKey);
  if (songs === undefined) {
    return [];
  }
  const props: DownloadedSong[] = [];
  for (let songId of songs.song_ids) {
    const properties: Properties | undefined = await fetchData({
      url: `${TAGGING_URL}/${songId}`,
      method: "GET",
      headers: headers,
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

export async function fetchSong(id: string, apiKey: string): Promise<Blob> {
  const headers = {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
  };
  const result: Blob = await fetchData({
    url: `${DOWNLOAD_URL}/${id}`,
    method: "GET",
    headers: headers,
    responseType: ResponseTypes.blob,
  });
  return result;
}

export async function fetchPropertiesFromItunes(
  query: string,
  apiKey: string,
  lookup: boolean = false,
  limit: number = 10
): Promise<DownloadedSong[]> {

  // todo: search redis index endpoint
  const headers = {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
  };
  const params = new URLSearchParams({
    query: query,
    lookup: lookup.toString(),
    limit: limit.toString()
  });
  const result: Properties[] = await fetchData({
    url: `${ITUNES_SEARCH_URL}?${params.toString()}`,
    method: "GET",
    headers: headers,
  });
  const props: DownloadedSong[] = [];
  for (let properties of result) {
    props.push({
      properties: properties,
    });
  }
  return props;
}

export async function fetchAlbumFromItunes(
  query: string,
  apiKey: string,
  lookup: boolean = false,
): Promise<AlbumProps[]> {

  // todo: search redis index endpoint
  const headers = {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
  };
  const params = new URLSearchParams({
    query: query,
    lookup: lookup.toString(),
    mode: "album"
  });
  const result: AlbumProps[] = await fetchData({
    url: `${ITUNES_SEARCH_URL}?${params.toString()}`,
    method: "GET",
    headers: headers,
  });
  return result;
}

interface IndexedProperties {
  uuid: string;
  properties: Properties;
  file_path: string;
}

interface IndexedDocument {
  id: string;
  json: string;
}
interface IndexResponse {
  total: string;
  duration: number;
  docs: IndexedDocument[];
}

export async function fetchPropertiesFromIndex(
  query: string,
  apiKey: string,
): Promise<DownloadedSong[]> {
  // todo: search redis index endpoint
  const headers = {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
  };
  const params = new URLSearchParams({
    query: query,
  });
  const result: IndexResponse = await fetchData({
    url: `${TAGGING_URL}?${params.toString()}`,
    method: "GET",
    headers: headers,
  });
  if (result === undefined) {
    return []
  }
  const props: DownloadedSong[] = [];
  for (let doc of result.docs) {
    const parsedDoc: IndexedProperties = JSON.parse(doc.json);
    props.push({
      songId: parsedDoc.uuid,
      properties: parsedDoc.properties,
    });
  }
  return props;
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
  apiKey: string,
): Promise<TaggingResponse> {
  const headers = {
    "x-api-key": apiKey,
    "Content-Type": "application/json",
  };
  const body: TaggingBody = {
    properties: properties,
    song_id: songId,
  };
  const result: TaggingResponse = await fetchData({
    url: `${TAGGING_URL}`,
    method: "PUT",
    headers: headers,
    body: body,
  });
  return result;
}
