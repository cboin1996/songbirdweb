'use client'
import { createContext, useContext } from 'react'

interface UserCtx {
  isAdmin: boolean
  username: string
}

const UserContext = createContext<UserCtx>({ isAdmin: false, username: '' })

export function UserProvider({ children, isAdmin, username }: {
  children: React.ReactNode
  isAdmin: boolean
  username: string
}) {
  return <UserContext.Provider value={{ isAdmin, username }}>{children}</UserContext.Provider>
}

export function useUser(): UserCtx {
  return useContext(UserContext)
}
