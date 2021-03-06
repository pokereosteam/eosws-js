import { socketFactory, runMain, waitFor, DFUSE_URL, DFUSE_API_KEY } from "./config"
import {
  EoswsClient,
  InboundMessage,
  InboundMessageType,
  createEoswsSocket,
  ActionTraceData,
  ListeningData,
  ErrorData,
  ApiTokenStorage,
  EoswsConnector
} from "@dfuse/eosws-js"
import fetch from "node-fetch"

interface Transfer {
  from: string
  to: string
  quantity: string
  memo: string
}

async function main() {
  const client = new EoswsClient({
    socket: createEoswsSocket(socketFactory),
    baseUrl: `https://${DFUSE_URL!}`,
    httpClient: fetch as any
  })
  const connector = new EoswsConnector({ client, apiKey: DFUSE_API_KEY! })
  await connector.connect()

  client
    .getActionTraces({ account: "eosio.token", action_name: "transfer" }, { with_progress: 2 })
    .onMessage((message: InboundMessage<any>) => {
      switch (message.type) {
        case InboundMessageType.ACTION_TRACE:
          const transfer = (message.data as ActionTraceData<Transfer>).trace.act.data
          console.log(
            `Transfer [${transfer.from} -> ${transfer.to}, ${transfer.quantity}] (${transfer.memo})`
          )
          break

        case InboundMessageType.LISTENING:
          const listeningResp = message as InboundMessage<ListeningData>
          console.log(
            `Received Listening message event, reqID: ${listeningResp.req_id}, next_block: ${
              listeningResp.data.next_block
            }`
          )
          break

        case InboundMessageType.ERROR:
          const error = message.data as ErrorData
          console.log(`Received error: ${error.message} (${error.code})`, error.details)
          break
        case InboundMessageType.PROGRESS:
          console.log("Progress at block_num: ***** %i *****", message.data.block_num)
          break
        default:
          console.log(`Unhandled message of type [${message.type}].`)
      }
    })

  // Example of disconnection/reconnection handling using the saved block_num.
  await waitFor(3000)
  await connector.disconnect()
  await waitFor(1500)

  console.log("****************************** RECONNECTING ***********************************")
  await connector.reconnect()
  await waitFor(2000)
}

runMain(main)
