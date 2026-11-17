import type { OrcApi } from '../../preload/index'
declare global {
  interface Window {
    orc: OrcApi
  }
}
export {}
