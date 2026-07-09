import { joinRoom, selfId, type Room } from 'trystero'
import type {
  FireMsg,
  HelloMsg,
  HitMsg,
  KillMsg,
  StateMsg,
} from './types'

export const APP_ID = 'nebula-arena-p2pgame-v1'
export { selfId }

export type NetHandlers = {
  onPeerJoin: (peerId: string) => void
  onPeerLeave: (peerId: string) => void
  onHello: (peerId: string, msg: HelloMsg) => void
  onState: (peerId: string, msg: StateMsg) => void
  onFire: (peerId: string, msg: FireMsg) => void
  onHit: (peerId: string, msg: HitMsg) => void
  onKill: (peerId: string, msg: KillMsg) => void
  onJoinError: (error: string) => void
}

export type NetSession = {
  room: Room
  roomId: string
  leave: () => Promise<void>
  sendHello: (msg: HelloMsg, target?: string) => void
  sendState: (msg: StateMsg) => void
  sendFire: (msg: FireMsg) => void
  sendHit: (msg: HitMsg) => void
  sendKill: (msg: KillMsg) => void
  getPeerIds: () => string[]
  ping: (peerId: string) => Promise<number>
}

function randomRoomCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
  let code = ''
  const bytes = crypto.getRandomValues(new Uint8Array(6))
  for (let i = 0; i < 6; i++) code += alphabet[bytes[i]! % alphabet.length]
  return code
}

export function createRoomCode(): string {
  return randomRoomCode()
}

export function connectRoom(
  roomId: string,
  handlers: NetHandlers,
): NetSession {
  const room = joinRoom(
    { appId: APP_ID },
    roomId.toUpperCase(),
    {
      onJoinError: (details) => {
        handlers.onJoinError(details.error || 'Failed to join room')
      },
    },
  )

  const hello = room.makeAction<HelloMsg>('hello')
  const state = room.makeAction<StateMsg>('state')
  const fire = room.makeAction<FireMsg>('fire')
  const hit = room.makeAction<HitMsg>('hit')
  const kill = room.makeAction<KillMsg>('kill')

  room.onPeerJoin = (peerId) => handlers.onPeerJoin(peerId)
  room.onPeerLeave = (peerId) => handlers.onPeerLeave(peerId)

  hello.onMessage = (msg, { peerId }) => handlers.onHello(peerId, msg)
  state.onMessage = (msg, { peerId }) => handlers.onState(peerId, msg)
  fire.onMessage = (msg, { peerId }) => handlers.onFire(peerId, msg)
  hit.onMessage = (msg, { peerId }) => handlers.onHit(peerId, msg)
  kill.onMessage = (msg, { peerId }) => handlers.onKill(peerId, msg)

  return {
    room,
    roomId: roomId.toUpperCase(),
    leave: () => room.leave(),
    sendHello: (msg, target) => {
      void hello.send(msg, target ? { target } : undefined)
    },
    sendState: (msg) => {
      void state.send(msg)
    },
    sendFire: (msg) => {
      void fire.send(msg)
    },
    sendHit: (msg) => {
      void hit.send(msg)
    },
    sendKill: (msg) => {
      void kill.send(msg)
    },
    getPeerIds: () => Object.keys(room.getPeers()),
    ping: (peerId) => room.ping(peerId),
  }
}
