import { ApiTokenInfo, EoswsClient } from "./client"
import { RefreshScheduler } from "./refresh-scheduler"
import { ApiTokenStorage, ApiTokenStorageInterface } from "./api-token-storage"
import { IDebugger } from "debug"
import debugFactory from "debug"

interface EoswsConnectorInterface {
  connect: () => Promise<void>
  getToken: () => Promise<ApiTokenInfo | undefined>
}

interface EoswsConnectorParams {
  apiKey: string
  tokenStorage?: ApiTokenStorageInterface
  client: EoswsClient
  delayBuffer?: number
}

/**
 * Represents a TokenRefresher.
 * @constructor
 * @param {ApiTokenStorageInterface} storage - storage interface with static methods 'get' and 'set'
 * only public method used is getToken() which will do the following:
 * - Check is token taken from storage exists and is not expired
 *   - will return is if it is not expired
 * - If token expired/doesn't exist, it will fetch a new token and schedule the next refresh
 */
export class EoswsConnector implements EoswsConnectorInterface {
  public tokenPromise?: Promise<ApiTokenInfo>
  public refreshScheduler: RefreshScheduler
  public tokenStorage: ApiTokenStorageInterface
  public client: EoswsClient
  public firstCall = true
  private apiKey: string
  private delayBuffer: number
  private debug: IDebugger

  // 120 seconds of buffer before connection expires by default
  private DEFAULT_DELAY_BUFFER_PERCENT = 0.9

  constructor(params: EoswsConnectorParams) {
    this.debug = debugFactory("eosws:connector")
    this.apiKey = params.apiKey
    this.client = params.client
    this.delayBuffer = params.delayBuffer ? params.delayBuffer : this.DEFAULT_DELAY_BUFFER_PERCENT
    this.tokenStorage = params.tokenStorage ? params.tokenStorage : new ApiTokenStorage()
    this.client.socket.setTokenStorage(this.tokenStorage)
    this.refreshScheduler = new RefreshScheduler(() => this.refreshToken())
  }

  public isExpiring(tokenInfo?: ApiTokenInfo): boolean {
    if (!tokenInfo) {
      return true
    }
    const now = Date.now() / 1000
    return tokenInfo.expires_at <= now
  }

  private getRefreshDelay(tokenInfo: ApiTokenInfo) {
    const now = Date.now() / 1000.0
    return (tokenInfo.expires_at - now) * 0.9
  }

  public async connect() {
    const apiToken = await this.getToken()
    if (apiToken) {
      this.tokenStorage.set(apiToken)
      return await this.client.connect()
    }
    throw new Error("error getting token")
  }

  public async reconnect() {
    await this.client.reconnect()
  }

  public async disconnect() {
    await this.client.disconnect()
  }

  public async getToken(): Promise<ApiTokenInfo | undefined> {
    const tokenInfo = this.tokenStorage.get()

    if (this.isExpiring(tokenInfo)) {
      this.firstCall = false
      const apiTokenInfo = await this.refreshToken()
      this.tokenStorage.set(apiTokenInfo)
      return apiTokenInfo
    }

    if (this.firstCall) {
      this.debug("Scheduling next token refresh - in getToken")
      this.refreshScheduler.scheduleNextRefresh(this.getRefreshDelay(tokenInfo!))
      this.firstCall = false
    }

    return Promise.resolve(tokenInfo)
  }

  public async refreshToken() {
    const tokenInfo = await this.fetchToken()

    if (tokenInfo) {
      this.tokenStorage.set(tokenInfo)
      this.debug("Scheduling next token refresh - in refreshToken")
      this.refreshScheduler.scheduleNextRefresh(this.getRefreshDelay(tokenInfo))
      return tokenInfo
    }
    throw new Error("error getting token")
  }

  private async fetchToken(): Promise<ApiTokenInfo | undefined> {
    if (this.tokenPromise !== undefined) {
      return this.tokenPromise
    }

    this.tokenPromise = new Promise<ApiTokenInfo>((resolve, reject) => {
      this.client
        .getNewApiToken(this.apiKey)
        .then((apiTokenInfo: ApiTokenInfo) => {
          this.tokenPromise = undefined
          return resolve(apiTokenInfo)
        })
        .catch((error: any) => {
          this.tokenPromise = undefined
          reject(error)
        })
    })

    return this.tokenPromise
  }
}
