import { openBrowser as openBrowserImpl } from '../../utils/browser.js'
import { saveProfileFile as saveProfileFileImpl } from '../../utils/providerProfile.js'
import { promptText as promptTextImpl } from './prompt.js'

export const openBrowser: typeof openBrowserImpl = url => openBrowserImpl(url)

export const saveProfileFile: typeof saveProfileFileImpl = options =>
  saveProfileFileImpl(options)

export const promptText: typeof promptTextImpl = (...args) => promptTextImpl(...args)
