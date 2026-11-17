import { notFound } from 'next/navigation'
import { RemoteStudio } from '@/components/remote-studio'

// A scene host's document, opened with `?sceneHost=<document URL>`. Only with the fork extensions on.
export default function StudioPage() {
  if (process.env.NEXT_PUBLIC_PASCAL_FORK_EXT !== '1') notFound()
  return <RemoteStudio />
}
