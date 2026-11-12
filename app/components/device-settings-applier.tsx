'use client'
import { useEffect } from 'react'
import { applyFrostedBars } from '../lib/device-settings'

// Puts this device's settings on the page as soon as it is up.
export default function DeviceSettingsApplier() {
    useEffect(() => { applyFrostedBars() }, [])
    return null
}
