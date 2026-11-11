// Logging out clears the cookies while the audio element may still be streaming.
// Whatever that stream's 401 sets in motion, it must not send the user to the
// login page with a ?next= of the page they are leaving: logout is already
// taking them to the login page itself.
export {}
type Data = typeof import('../app/lib/data')

const fetchMock = jest.fn()

async function load(): Promise<Data> {
    let mod!: Data
    await jest.isolateModulesAsync(async () => { mod = await import('../app/lib/data') })
    return mod
}

beforeEach(() => {
    fetchMock.mockReset()
    fetchMock.mockResolvedValue({ ok: true, status: 200 })
    global.fetch = fetchMock as unknown as typeof fetch
    window.history.pushState({}, '', '/download')
})

describe('redirectToLogin after logout', () => {
    it('does not navigate once a logout has started', async () => {
        const data = await load()
        const pending = data.logout()
        // The stream's 401 can land at any point after the cookies are cleared,
        // including while the logout request is still in flight.
        expect(data.redirectToLogin()).toBe(false)
        await pending
        expect(data.redirectToLogin()).toBe(false)
        expect(window.location.pathname).toBe('/download')
    })

    it('reports that a sign-out is under way', async () => {
        const data = await load()
        expect(data.isSigningOut()).toBe(false)
        const pending = data.logout()
        expect(data.isSigningOut()).toBe(true)
        await pending
    })
})

// Where a dead session sends the user. The page navigates away the moment this
// is set, so a toast raised just before it never gets seen; the login page has to
// say why, and it can only do that from the URL.
describe('loginRedirectUrl', () => {
    it('keeps the page being left and says the session expired', async () => {
        const data = await load()
        expect(data.loginRedirectUrl('/library', '?sort=name'))
            .toBe('/?next=%2Flibrary%3Fsort%3Dname&expired=1')
    })

    it('works for a page with no query', async () => {
        const data = await load()
        expect(data.loginRedirectUrl('/download', '')).toBe('/?next=%2Fdownload&expired=1')
    })
})

// A shared device: the next person to sign in must not be offered the previous
// account's queue or library lists.
describe('what a logout leaves on the device', () => {
    function installCaches(names: string[]) {
        const kept = new Set(names)
        Object.defineProperty(globalThis, 'caches', {
            configurable: true,
            value: {
                keys: async () => [...kept],
                delete: async (name: string) => kept.delete(name),
            },
        })
        return kept
    }

    afterEach(() => {
        Object.defineProperty(globalThis, 'caches', { configurable: true, value: undefined })
        localStorage.clear()
    })

    it("forgets the player's last state", async () => {
        localStorage.setItem('playerState', JSON.stringify({ queue: ['a'] }))
        localStorage.setItem('playerVolume', '0.4')
        await (await load()).logout()
        expect(localStorage.getItem('playerState')).toBeNull()
        // Not the account's: the volume belongs to the device.
        expect(localStorage.getItem('playerVolume')).toBe('0.4')
    })

    it("forgets the service worker's copies of API answers and keeps the rest", async () => {
        const kept = installCaches(['songbird-api-v2', 'songbird-shell-v0.5.15', 'songbird-artwork-v1'])
        await (await load()).logout()
        expect([...kept].sort()).toEqual(['songbird-artwork-v1', 'songbird-shell-v0.5.15'])
    })

    it('still signs out when the request fails, and still forgets', async () => {
        fetchMock.mockRejectedValue(new TypeError('failed to fetch'))
        localStorage.setItem('playerState', JSON.stringify({ queue: ['a'] }))
        silenceConsole()
        const data = await load()
        await data.logout()
        expect(data.isSigningOut()).toBe(true)
        expect(localStorage.getItem('playerState')).toBeNull()
    })
})

function silenceConsole() {
    jest.spyOn(console, 'error').mockImplementation(() => {})
}
