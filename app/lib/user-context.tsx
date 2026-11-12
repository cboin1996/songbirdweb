'use client'
import { createContext, useContext, useEffect, useMemo, useState } from 'react'

const ADMIN_KEY = 'songbird:isAdmin'

interface UserCtx {
  isAdmin: boolean
  username: string
  userLoaded: boolean
}

const UserContext = createContext<UserCtx>({ isAdmin: false, username: '', userLoaded: false })

export function UserProvider({ children, isAdmin, username, userLoaded }: {
  children: React.ReactNode
  isAdmin: boolean
  username: string
  userLoaded: boolean
}) {
  const [cachedAdmin, setCachedAdmin] = useState(isAdmin)

  useEffect(() => {
    if (userLoaded) {
      setCachedAdmin(isAdmin)
      try { localStorage.setItem(ADMIN_KEY, String(isAdmin)) } catch {}
    } else {
      try {
        const stored = localStorage.getItem(ADMIN_KEY)
        if (stored === 'true') setCachedAdmin(true)
      } catch {}
    }
  }, [userLoaded, isAdmin])

  const shownAdmin = userLoaded ? isAdmin : cachedAdmin
  const value = useMemo(() => ({ isAdmin: shownAdmin, username, userLoaded }), [shownAdmin, username, userLoaded])

  return (
    <UserContext.Provider value={value}>
      {children}
    </UserContext.Provider>
  )
}

export function useUser(): UserCtx {
  return useContext(UserContext)
}
