export type InputState = {
  up: boolean
  down: boolean
  left: boolean
  right: boolean
  fire: boolean
  boost: boolean
  mouseX: number
  mouseY: number
  pointerDown: boolean
}

const STICK_DEADZONE = 0.22
const AIM_RADIUS_CSS = 120

type StickIds = {
  move: HTMLElement
  aim: HTMLElement
  fire: HTMLElement
  boost: HTMLElement
}

export function createInput(
  canvas: HTMLCanvasElement,
  touch?: StickIds,
): {
  state: InputState
  destroy: () => void
} {
  const state: InputState = {
    up: false,
    down: false,
    left: false,
    right: false,
    fire: false,
    boost: false,
    mouseX: canvas.width / 2,
    mouseY: canvas.height / 2,
    pointerDown: false,
  }

  let keyFire = false
  let touchFire = false
  let canvasFire = false
  let keyBoost = false
  let touchBoost = false

  const syncFireBoost = () => {
    state.fire = keyFire || touchFire || canvasFire
    state.boost = keyBoost || touchBoost
  }

  const setKey = (code: string, pressed: boolean) => {
    switch (code) {
      case 'KeyW':
      case 'ArrowUp':
        state.up = pressed
        break
      case 'KeyS':
      case 'ArrowDown':
        state.down = pressed
        break
      case 'KeyA':
      case 'ArrowLeft':
        state.left = pressed
        break
      case 'KeyD':
      case 'ArrowRight':
        state.right = pressed
        break
      case 'Space':
        keyFire = pressed
        syncFireBoost()
        break
      case 'ShiftLeft':
      case 'ShiftRight':
        keyBoost = pressed
        syncFireBoost()
        break
    }
  }

  const onKeyDown = (e: KeyboardEvent) => {
    if (['Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(e.code)) {
      e.preventDefault()
    }
    setKey(e.code, true)
  }
  const onKeyUp = (e: KeyboardEvent) => setKey(e.code, false)

  const onPointerMove = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return
    const rect = canvas.getBoundingClientRect()
    state.mouseX = ((e.clientX - rect.left) / rect.width) * canvas.width
    state.mouseY = ((e.clientY - rect.top) / rect.height) * canvas.height
  }
  const onPointerDown = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return
    if (e.button === 0) {
      state.pointerDown = true
      canvasFire = true
      syncFireBoost()
      canvas.setPointerCapture(e.pointerId)
    }
  }
  const onPointerUp = (e: PointerEvent) => {
    if (e.pointerType === 'touch') return
    if (e.button === 0) {
      state.pointerDown = false
      canvasFire = false
      syncFireBoost()
    }
  }
  const onBlur = () => {
    state.up = state.down = state.left = state.right = false
    keyFire = touchFire = canvasFire = false
    keyBoost = touchBoost = false
    state.pointerDown = false
    syncFireBoost()
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)
  window.addEventListener('blur', onBlur)

  const cleanups: Array<() => void> = []

  if (touch) {
    cleanups.push(
      bindMoveStick(touch.move, state),
      bindAimStick(touch.aim, canvas, state),
      bindHoldButton(touch.fire, (down) => {
        touchFire = down
        syncFireBoost()
      }),
      bindHoldButton(touch.boost, (down) => {
        touchBoost = down
        syncFireBoost()
      }),
    )
  }

  return {
    state,
    destroy: () => {
      window.removeEventListener('keydown', onKeyDown)
      window.removeEventListener('keyup', onKeyUp)
      canvas.removeEventListener('pointermove', onPointerMove)
      canvas.removeEventListener('pointerdown', onPointerDown)
      canvas.removeEventListener('pointerup', onPointerUp)
      canvas.removeEventListener('pointercancel', onPointerUp)
      window.removeEventListener('blur', onBlur)
      for (const c of cleanups) c()
    },
  }
}

function stickVector(
  el: HTMLElement,
  clientX: number,
  clientY: number,
): { x: number; y: number; knobX: number; knobY: number; max: number } {
  const rect = el.getBoundingClientRect()
  const cx = rect.left + rect.width / 2
  const cy = rect.top + rect.height / 2
  const max = rect.width * 0.38
  let dx = clientX - cx
  let dy = clientY - cy
  const mag = Math.hypot(dx, dy)
  if (mag > max && mag > 0) {
    dx = (dx / mag) * max
    dy = (dy / mag) * max
  }
  return {
    x: max > 0 ? dx / max : 0,
    y: max > 0 ? dy / max : 0,
    knobX: dx,
    knobY: dy,
    max,
  }
}

function setKnob(el: HTMLElement, x: number, y: number) {
  const knob = el.querySelector<HTMLElement>('.stick-knob')
  if (knob) {
    knob.style.transform = `translate(calc(-50% + ${x}px), calc(-50% + ${y}px))`
  }
  el.classList.toggle('active', x !== 0 || y !== 0)
}

function bindMoveStick(el: HTMLElement, state: InputState): () => void {
  let pointerId: number | null = null

  const apply = (x: number, y: number) => {
    const mag = Math.hypot(x, y)
    if (mag < STICK_DEADZONE) {
      state.up = state.down = state.left = state.right = false
      return
    }
    // Prefer 8-way from normalized vector
    const nx = x / mag
    const ny = y / mag
    state.left = nx < -0.35
    state.right = nx > 0.35
    state.up = ny < -0.35
    state.down = ny > 0.35
  }

  const onDown = (e: PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    pointerId = e.pointerId
    el.setPointerCapture(e.pointerId)
    const v = stickVector(el, e.clientX, e.clientY)
    setKnob(el, v.knobX, v.knobY)
    apply(v.x, v.y)
  }
  const onMove = (e: PointerEvent) => {
    if (pointerId !== e.pointerId) return
    e.preventDefault()
    const v = stickVector(el, e.clientX, e.clientY)
    setKnob(el, v.knobX, v.knobY)
    apply(v.x, v.y)
  }
  const onUp = (e: PointerEvent) => {
    if (pointerId !== e.pointerId) return
    pointerId = null
    setKnob(el, 0, 0)
    state.up = state.down = state.left = state.right = false
  }

  el.addEventListener('pointerdown', onDown)
  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerup', onUp)
  el.addEventListener('pointercancel', onUp)

  return () => {
    el.removeEventListener('pointerdown', onDown)
    el.removeEventListener('pointermove', onMove)
    el.removeEventListener('pointerup', onUp)
    el.removeEventListener('pointercancel', onUp)
    setKnob(el, 0, 0)
  }
}

function bindAimStick(
  el: HTMLElement,
  canvas: HTMLCanvasElement,
  state: InputState,
): () => void {
  let pointerId: number | null = null
  let lastX = 0
  let lastY = -0.85 // default aim "forward"/up until first touch

  const writeAim = (x: number, y: number) => {
    const mag = Math.hypot(x, y)
    if (mag >= STICK_DEADZONE) {
      lastX = x / mag
      lastY = y / mag
    }
    const rect = canvas.getBoundingClientRect()
    const cssX = rect.width / 2 + lastX * AIM_RADIUS_CSS
    const cssY = rect.height / 2 + lastY * AIM_RADIUS_CSS
    state.mouseX = (cssX / rect.width) * canvas.width
    state.mouseY = (cssY / rect.height) * canvas.height
  }

  // Seed an initial aim so ships aren't stuck facing right-only weirdness on first frame
  writeAim(lastX, lastY)

  const onDown = (e: PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    pointerId = e.pointerId
    el.setPointerCapture(e.pointerId)
    const v = stickVector(el, e.clientX, e.clientY)
    setKnob(el, v.knobX, v.knobY)
    writeAim(v.x, v.y)
  }
  const onMove = (e: PointerEvent) => {
    if (pointerId !== e.pointerId) return
    e.preventDefault()
    const v = stickVector(el, e.clientX, e.clientY)
    setKnob(el, v.knobX, v.knobY)
    writeAim(v.x, v.y)
  }
  const onUp = (e: PointerEvent) => {
    if (pointerId !== e.pointerId) return
    pointerId = null
    setKnob(el, 0, 0)
    // Keep last aim direction when stick released
    writeAim(lastX, lastY)
  }

  el.addEventListener('pointerdown', onDown)
  el.addEventListener('pointermove', onMove)
  el.addEventListener('pointerup', onUp)
  el.addEventListener('pointercancel', onUp)

  return () => {
    el.removeEventListener('pointerdown', onDown)
    el.removeEventListener('pointermove', onMove)
    el.removeEventListener('pointerup', onUp)
    el.removeEventListener('pointercancel', onUp)
    setKnob(el, 0, 0)
  }
}

function bindHoldButton(el: HTMLElement, onChange: (down: boolean) => void): () => void {
  const active = new Set<number>()

  const sync = () => {
    const down = active.size > 0
    el.classList.toggle('active', down)
    onChange(down)
  }

  const onDown = (e: PointerEvent) => {
    e.preventDefault()
    e.stopPropagation()
    active.add(e.pointerId)
    el.setPointerCapture(e.pointerId)
    sync()
  }
  const onUp = (e: PointerEvent) => {
    if (!active.has(e.pointerId)) return
    active.delete(e.pointerId)
    sync()
  }

  el.addEventListener('pointerdown', onDown)
  el.addEventListener('pointerup', onUp)
  el.addEventListener('pointercancel', onUp)

  return () => {
    el.removeEventListener('pointerdown', onDown)
    el.removeEventListener('pointerup', onUp)
    el.removeEventListener('pointercancel', onUp)
    active.clear()
    el.classList.remove('active')
    onChange(false)
  }
}
