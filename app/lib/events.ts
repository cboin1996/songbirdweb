export const EVENTS = {
    draftChanged: 'songbird:draft-changed',
    offlineCleared: 'songbird:offline-cleared',
    serverUnreachable: 'songbird:server-unreachable',
    serverReachable: 'songbird:server-reachable',
    /** A song's art was replaced: detail { songId, version }. Players holding that song take the new version. */
    artworkChanged: 'songbird:artwork-changed',
} as const
