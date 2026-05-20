import { Event } from './event.js'

export class PasteEvent extends Event {
  constructor(
    readonly text: string = '',
  ) {
    super()
  }
}
