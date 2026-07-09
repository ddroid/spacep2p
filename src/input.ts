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

export function createInput(canvas: HTMLCanvasElement): {
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
    mouseX: 0,
    mouseY: 0,
    pointerDown: false,
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
        state.fire = pressed
        break
      case 'ShiftLeft':
      case 'ShiftRight':
        state.boost = pressed
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
    const rect = canvas.getBoundingClientRect()
    state.mouseX = ((e.clientX - rect.left) / rect.width) * canvas.width
    state.mouseY = ((e.clientY - rect.top) / rect.height) * canvas.height
  }
  const onPointerDown = (e: PointerEvent) => {
    if (e.button === 0) {
      state.pointerDown = true
      state.fire = true
      canvas.setPointerCapture(e.pointerId)
    }
  }
  const onPointerUp = (e: PointerEvent) => {
    if (e.button === 0) {
      state.pointerDown = false
      state.fire = false
    }
  }
  const onBlur = () => {
    state.up = state.down = state.left = state.right = false
    state.fire = state.boost = state.pointerDown = false
  }

  window.addEventListener('keydown', onKeyDown)
  window.addEventListener('keyup', onKeyUp)
  canvas.addEventListener('pointermove', onPointerMove)
  canvas.addEventListener('pointerdown', onPointerDown)
  canvas.addEventListener('pointerup', onPointerUp)
  canvas.addEventListener('pointercancel', onPointerUp)
  window.addEventListener('blur', onBlur)

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
    },
  }
}
