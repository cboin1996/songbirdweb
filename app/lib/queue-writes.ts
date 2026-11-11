// The server's copy of the player is written two ways: one request per queue change
// (insert, remove, reorder), and the whole state, saved two seconds after the last
// change. Each describes the player as it was when the user acted, so they only
// mean the same thing if they reach the server in the order they were made. Fired
// freely, a slow one is overtaken by a quick one: "play now" on a song already
// queued removes it and puts it back, and a remove that arrives last deletes the
// song that was just put back.
//
// One chain, one write at a time. Each write has a time limit, so a request that
// never answers cannot hold up the user's later changes.
//
// The whole-state save is built when it is sent, not when it is queued, so it is
// never an old snapshot, and it already holds every change made so far. That makes
// it the one write that can stand in for the others: while one waits, there is at
// most that one, a newer replaces it, and queue changes waiting beside it are
// dropped. A queue change that fails or times out is followed by a fresh whole-state
// save, which repairs whatever the server missed. A whole-state save that fails has
// nothing after it to repair it, so the owner sends it again (`resendIfFailed`) when
// the server can be reached.

async function runWithLimit(run: (signal: AbortSignal) => Promise<void>, limitMs: number): Promise<void> {
    const controller = new AbortController()
    let timer: ReturnType<typeof setTimeout> | undefined
    const timeout = new Promise<never>((_, reject) => {
        timer = setTimeout(() => {
            controller.abort()
            reject(new Error(`write timed out after ${limitMs} ms`))
        }, limitMs)
    })
    try {
        await Promise.race([run(controller.signal), timeout])
    } finally {
        clearTimeout(timer)
    }
}

interface Waiting {
    kind: 'queue' | 'state'
    run: (signal: AbortSignal) => Promise<void>
    resolve: () => void
    reject: (err: unknown) => void
}

// `limit` may be a function, read when each write starts.
export function createWriteChain<S>(limit: number | (() => number), sendState: (state: S, signal: AbortSignal) => Promise<void>) {
    const waiting: Waiting[] = []
    let inFlight = false
    let lastBuild: (() => S) | null = null
    // The last whole-state save did not reach the server, and none has since.
    let stateFailed = false
    let sendingState = false

    async function pump() {
        if (inFlight) return
        inFlight = true
        while (waiting.length > 0) {
            const item = waiting.shift()!
            sendingState = item.kind === 'state'
            try {
                await runWithLimit(item.run, typeof limit === 'function' ? limit() : limit)
                if (item.kind === 'state') stateFailed = false
                item.resolve()
            } catch (err) {
                if (item.kind === 'state') stateFailed = true
                // The caller of a background write usually ignores the failure, so this
                // is the only trace of a change the server did not hear.
                console.warn(`player ${item.kind} write failed`, err instanceof Error ? err.message : err)
                item.reject(err)
                // The server may have missed this change, or heard it late. A save
                // of the whole state after it puts the server where the screen is.
                if (item.kind === 'queue' && lastBuild) enqueueState(lastBuild).catch(() => {})
            }
        }
        sendingState = false
        inFlight = false
    }

    // A write that is waiting is replaced by the one that supersedes it, and its
    // caller is told it went out: the change it carried is in the replacement.
    function supersede(keep: (w: Waiting) => boolean) {
        for (let i = waiting.length - 1; i >= 0; i--) {
            if (!keep(waiting[i])) {
                console.debug(`player ${waiting[i].kind} write replaced by a newer save of the whole state`)
                waiting.splice(i, 1)[0].resolve()
            }
        }
    }

    function enqueueQueue(run: (signal: AbortSignal) => Promise<void>): Promise<void> {
        // A whole-state save is waiting and will be built after this change was made.
        if (waiting.some(w => w.kind === 'state')) return Promise.resolve()
        return new Promise<void>((resolve, reject) => {
            waiting.push({ kind: 'queue', run, resolve, reject })
            void pump()
        })
    }

    function enqueueState(build: () => S): Promise<void> {
        lastBuild = build
        supersede(() => false)
        return new Promise<void>((resolve, reject) => {
            waiting.push({ kind: 'state', run: signal => sendState(build(), signal), resolve, reject })
            void pump()
        })
    }

    // Sends the state again if the last save of it failed. Called when the server has
    // come back, not on a timer: a server that answers with an error would be asked
    // again and again.
    function resendIfFailed() {
        if (!stateFailed || !lastBuild || sendingState || waiting.some(w => w.kind === 'state')) return
        enqueueState(lastBuild).catch(() => {})
    }

    return {
        enqueue: enqueueQueue,
        enqueueState,
        resendIfFailed,
        // A write is waiting or on its way: the server has not yet heard all the
        // user has done.
        pending: () => inFlight || waiting.length > 0,
    }
}
