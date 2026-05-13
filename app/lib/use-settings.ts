import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query'
import { fetchSettings, updateSettings, UserSettings } from './data'
import { queryKeys } from './query-keys'

export function useSettings() {
  const queryClient = useQueryClient()

  const { data: settings, isLoading } = useQuery({
    queryKey: queryKeys.settings,
    queryFn: fetchSettings,
    staleTime: Infinity,
  })

  const { mutateAsync: saveSettings } = useMutation({
    mutationFn: updateSettings,
    onSuccess: (updated) => {
      queryClient.setQueryData(queryKeys.settings, updated)
    },
  })

  return {
    settings: settings ?? { audio_format: 'mp3' as const },
    settingsLoaded: !isLoading,
    saveSettings,
  }
}
