import { Event } from './event.js'

export class ResizeEvent extends Event {
  constructor(
    readonly width: number,
    readonly height: number,
  ) {
    super()
  }
}
