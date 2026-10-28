/**
 * Royalty shader effects — ported from the website's
 * `packages/ui/src/components/royalty-{aura,name}.tsx`.
 *
 * Two deliberately different effects built from the same gold/violet
 * palette:
 *
 *   - `RoyaltyAura` — the corona of light behind the tier banner on the
 *     profile's rank card.
 *   - `RoyaltyName` — the gilded, jewel-flecked display name used for the
 *     #1 ranked Royalty player.
 *
 * Both degrade gracefully: no WebGL (or reduced motion) falls back to the
 * animated CSS gradient for the name, and no aura at all for the banner.
 * The launcher adds the accompanying `.royalty-name-glow` /
 * `@keyframes royalty-name` rules in `src/index.css`.
 */

import { useEffect, useRef, useState } from 'react'
import { useReducedMotion } from 'framer-motion'

import { cn } from '@/lib/utils'

const AURA_VERTEX_SHADER = `
attribute vec2 position;
varying vec2 uv;
void main() {
  uv = position;
  gl_Position = vec4(position, 0.0, 1.0);
}
`

// Generated light only: no textures, images, or external shader dependencies.
const AURA_FRAGMENT_SHADER = `
precision mediump float;
varying vec2 uv;
uniform float phase;
uniform float aspect;
const float TAU = 6.283185;
float angularDistance(float a, float b) {
  return abs(mod(a - b + 3.141593, TAU) - 3.141593);
}
void main() {
  vec2 p = uv * vec2(aspect, 1.0);
  vec2 orbit = p / vec2(1.48, 0.55);
  float radius = length(orbit);
  float angle = atan(orbit.y, orbit.x);
  vec3 gold = vec3(1.0, 0.57, 0.09);
  vec3 paleGold = vec3(1.0, 0.86, 0.43);
  vec3 violet = vec3(0.46, 0.08, 1.0);

  // An irregular flowing corona, with bright gold filaments and violet bloom.
  float ripple = sin(angle * 7.0 + phase * 3.0) * 0.035
               + sin(angle * 11.0 - phase * 2.0) * 0.018;
  float edge = abs(radius - 1.0 - ripple);
  float flow = 0.5 + 0.5 * sin(angle * 3.0 - phase * 2.0);
  vec3 light = mix(violet, gold, flow) * exp(-edge * 13.0) * 0.65;
  light += paleGold * exp(-edge * 95.0) * pow(flow, 4.0) * 0.8;
  light += violet * exp(-pow(radius / 0.9, 2.0)) * 0.2;

  // Two orbiting light trails moving in opposite directions.
  float head = phase * 2.0;
  float trail = mod(head - angle + TAU * 4.0, TAU);
  float outerEdge = abs(radius - 1.14 + ripple * 0.5);
  light += gold * exp(-edge * 28.0) * exp(-trail * 2.2) * 1.2;
  light += paleGold * exp(-edge * 60.0)
         * exp(-angularDistance(angle, head) * 32.0) * 2.0;
  light += violet * exp(-outerEdge * 35.0)
         * exp(-mod(angle + phase + TAU * 4.0, TAU) * 1.8) * 0.8;

  // A coronation burst radiates from the crown every six seconds.
  float progress = clamp(fract(phase / TAU * 2.0) * 2.7, 0.0, 1.0);
  float pulse = sin(progress * 3.141593) * (1.0 - progress);
  float wave = exp(-abs(radius - (0.55 + progress * 1.05)) * 42.0);
  light += paleGold * wave * pulse * 1.5;
  float rays = pow(max(0.0, sin(angle * 12.0 + sin(angle * 5.0))), 14.0);
  light += gold * rays * exp(-abs(radius - 1.05) * 5.0) * pulse * 0.55;

  // Gold embers lift away from the badge, fading before each loop resets.
  for (int i = 0; i < 8; i++) {
    float seed = float(i);
    float life = fract(phase / TAU + seed * 0.137);
    float x = sin(seed * 7.13) * 1.18 + sin(life * 3.0 + seed) * 0.08;
    float y = 0.12 + life * 0.67;
    vec2 delta = p - vec2(x, y);
    float spark = exp(-length(delta * vec2(1.0, 0.55)) * 170.0);
    light += paleGold * spark * sin(life * 3.141593) * 1.3;
  }

  // Keep the boundary fade outside the pulse's maximum radius (1.6).
  // Its vertical extent is 1.6 * 0.55 = 0.88, plus a soft glow tail.
  float fade = (1.0 - smoothstep(0.83, 1.0, abs(uv.x)))
             * (1.0 - smoothstep(0.93, 1.0, abs(uv.y)));
  light = (1.0 - exp(-light)) * fade;
  float alpha = max(light.r, max(light.g, light.b));
  gl_FragColor = vec4(light / max(alpha, 0.001), alpha);
}
`

/** A looping, transparent light shader behind the Royalty tier artwork. */
export function RoyaltyAura() {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    const gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: false,
      depth: false,
      powerPreference: 'low-power',
    })
    if (!gl) return

    let dispose = () => {}
    const setup = () => {
      dispose()
      const shaders: WebGLShader[] = []
      let program: WebGLProgram | null = null
      let buffer: WebGLBuffer | null = null
      let frame = 0
      const cleanups: Array<() => void> = []
      dispose = () => {
        cancelAnimationFrame(frame)
        cleanups.forEach((cleanup) => cleanup())
        shaders.forEach((shader) => gl.deleteShader(shader))
        if (buffer) gl.deleteBuffer(buffer)
        if (program) gl.deleteProgram(program)
      }
      const compile = (type: number, source: string) => {
        const shader = gl.createShader(type)
        if (!shader) return null
        shaders.push(shader)
        gl.shaderSource(shader, source)
        gl.compileShader(shader)
        return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null
      }
      const vertex = compile(gl.VERTEX_SHADER, AURA_VERTEX_SHADER)
      const fragment = compile(gl.FRAGMENT_SHADER, AURA_FRAGMENT_SHADER)
      program = gl.createProgram()
      buffer = gl.createBuffer()
      if (!vertex || !fragment || !program || !buffer) {
        dispose()
        return
      }
      gl.attachShader(program, vertex)
      gl.attachShader(program, fragment)
      gl.linkProgram(program)
      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        dispose()
        return
      }
      gl.useProgram(program)
      gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
      gl.bufferData(
        gl.ARRAY_BUFFER,
        new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]),
        gl.STATIC_DRAW,
      )
      const position = gl.getAttribLocation(program, 'position')
      gl.enableVertexAttribArray(position)
      gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)
      const phase = gl.getUniformLocation(program, 'phase')
      const aspect = gl.getUniformLocation(program, 'aspect')
      const start = performance.now()
      let lastFrame = -Infinity

      const render = (now: number) => {
        // Cap GPU work at 30fps; phase repeats seamlessly after 12 seconds.
        if (now - lastFrame >= 1000 / 30) {
          const elapsed = ((now - start) % 12_000) / 12_000
          gl.uniform1f(phase, reduceMotion ? 1.4 : elapsed * Math.PI * 2)
          gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
          lastFrame = now
        }
        if (!reduceMotion) frame = requestAnimationFrame(render)
      }
      const resize = () => {
        const bounds = canvas.getBoundingClientRect()
        const ratio = Math.min(window.devicePixelRatio || 1, 2)
        canvas.width = Math.max(1, Math.round(bounds.width * ratio))
        canvas.height = Math.max(1, Math.round(bounds.height * ratio))
        gl.viewport(0, 0, canvas.width, canvas.height)
        gl.uniform1f(aspect, canvas.width / canvas.height)
        lastFrame = -Infinity
        cancelAnimationFrame(frame)
        render(performance.now())
      }
      const resizeObserver = new ResizeObserver(resize)
      resizeObserver.observe(canvas)
      cleanups.push(() => resizeObserver.disconnect())
      resize()
    }
    const onContextLost = (event: Event) => {
      event.preventDefault()
      dispose()
    }
    canvas.addEventListener('webglcontextlost', onContextLost)
    canvas.addEventListener('webglcontextrestored', setup)
    setup()
    return () => {
      dispose()
      canvas.removeEventListener('webglcontextlost', onContextLost)
      canvas.removeEventListener('webglcontextrestored', setup)
    }
  }, [reduceMotion])

  return (
    <span aria-hidden className="pointer-events-none absolute inset-0">
      <span
        className="absolute -inset-x-3 -inset-y-2 rounded-full opacity-40 blur-[8px]"
        style={{
          background: 'radial-gradient(ellipse, #9333ea, transparent 70%)',
        }}
      />
      <canvas
        ref={canvasRef}
        // Widen only: aspect correction preserves the effect's size while
        // providing room for the expanding pulse and its glow on both sides.
        className="absolute -top-[125%] -left-[70%] h-[350%] w-[240%]"
      />
    </span>
  )
}

const NAME_VERTEX_SHADER = `
attribute vec2 position;
varying vec2 uv;
void main() {
  uv = position * 0.5 + 0.5;
  gl_Position = vec4(position, 0.0, 1.0);
}
`

const NAME_FRAGMENT_SHADER = `
precision mediump float;
varying vec2 uv;
uniform sampler2D uText;
uniform float uTime;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123);
}

void main() {
  float mask = texture2D(uText, uv).a;
  if (mask < 0.04) discard;

  // Royal palette: deep antique gold at the baseline, bright gold
  // through the body, a pale rim at the cap line, purple in the edges.
  vec3 deepGold = vec3(0.68, 0.38, 0.03);
  vec3 gold = vec3(1.0, 0.76, 0.18);
  vec3 pale = vec3(1.0, 0.97, 0.78);
  vec3 violet = vec3(0.36, 0.08, 0.72);

  float y = uv.y;
  vec3 color = mix(deepGold, gold, smoothstep(0.0, 0.55, y));
  color = mix(color, pale, smoothstep(0.72, 1.0, y) * 0.9);

  // A polished-metal sheen sweeping diagonally across the letters.
  float diag = uv.x * 0.9 + (1.0 - y) * 0.35;
  float sheen = fract(diag - uTime * 0.18);
  color += pale * pow(max(0.0, 1.0 - abs(sheen - 0.5) * 5.0), 5.0) * 0.9;

  // A travelling bloom: warm gold light drifts across the name, with a
  // violet trail following just behind it.
  float travel = 0.5 + 0.5 * sin(uTime * 0.75);
  float bloom = exp(-abs(uv.x - travel) * 8.0);
  color += pale * bloom * (0.45 + 0.25 * y);
  float trail = exp(-abs(uv.x - fract(travel + 0.22)) * 5.0);
  color += violet * trail * 0.35;

  // Royal purple bleeding in from the outer edges.
  float edge = 1.0 - smoothstep(0.0, 0.4, min(uv.x, 1.0 - uv.x));
  color = mix(color, violet * 1.15, edge * 0.5);

  // Crown-jewel sparkles: a grid of points that twinkle out of phase.
  vec2 cell = floor(uv * vec2(26.0, 7.0));
  vec2 local = fract(uv * vec2(26.0, 7.0)) - 0.5;
  float seed = hash(cell);
  float jewel = exp(-dot(local, local) * 30.0);
  float twinkle = pow(max(0.0, sin(uTime * 2.4 + seed * 6.283)), 10.0);
  color += pale * jewel * twinkle * 1.6;

  // A bright cap line, so the top of the name reads like gilded trim.
  color += pale * 0.35 * smoothstep(0.88, 1.0, y);

  gl_FragColor = vec4(color, mask);
}
`

const NAME_FALLBACK_CLASSES =
  'bg-[linear-gradient(110deg,#ad6110_0%,#ffc230_20%,#fff3c4_45%,#ffc230_65%,#5c14b8_100%)] bg-[length:250%_100%] bg-clip-text text-transparent motion-safe:animate-[royalty-name_6s_linear_infinite]'

function compile(gl: WebGLRenderingContext, type: number, source: string): WebGLShader | null {
  const shader = gl.createShader(type)
  if (!shader) return null
  gl.shaderSource(shader, source)
  gl.compileShader(shader)
  return gl.getShaderParameter(shader, gl.COMPILE_STATUS) ? shader : null
}

/**
 * Gilded display name for the #1 Royalty player.
 *
 * The text is rasterised into a texture once (and on resize), then the
 * fragment shader colours it. The real text stays in the DOM for layout and
 * accessibility; it is made transparent only after the first WebGL frame
 * lands. Without WebGL (or with reduced motion) the animated gradient is the
 * fallback.
 */
export function RoyaltyName({ children, className }: { children: string; className?: string }) {
  const textRef = useRef<HTMLSpanElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [shaded, setShaded] = useState(false)
  const reduceMotion = useReducedMotion()

  useEffect(() => {
    if (reduceMotion) return
    const text = textRef.current
    const canvas = canvasRef.current
    if (!text || !canvas) return

    const gl = canvas.getContext('webgl', {
      alpha: true,
      premultipliedAlpha: false,
      antialias: true,
      depth: false,
    })
    if (!gl) return

    let frame = 0
    let disposed = false
    let texture: WebGLTexture | null = null
    let program: WebGLProgram | null = null
    let buffer: WebGLBuffer | null = null

    const vertex = compile(gl, gl.VERTEX_SHADER, NAME_VERTEX_SHADER)
    const fragment = compile(gl, gl.FRAGMENT_SHADER, NAME_FRAGMENT_SHADER)
    if (!vertex || !fragment) return
    program = gl.createProgram()
    if (!program) return
    gl.attachShader(program, vertex)
    gl.attachShader(program, fragment)
    gl.linkProgram(program)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return
    gl.useProgram(program)

    buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW)
    const position = gl.getAttribLocation(program, 'position')
    gl.enableVertexAttribArray(position)
    gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0)

    texture = gl.createTexture()
    gl.bindTexture(gl.TEXTURE_2D, texture)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR)
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR)
    gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 1)
    gl.uniform1i(gl.getUniformLocation(program, 'uText'), 0)

    const timeUniform = gl.getUniformLocation(program, 'uTime')
    const raster = document.createElement('canvas')
    const rasterCtx = raster.getContext('2d')

    const upload = () => {
      if (!rasterCtx) return
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const width = Math.max(1, Math.round(text.clientWidth * dpr))
      const height = Math.max(1, Math.round(text.clientHeight * dpr))
      canvas.width = width
      canvas.height = height
      raster.width = width
      raster.height = height

      const style = getComputedStyle(text)
      const fontSize = Number.parseFloat(style.fontSize) || 16
      rasterCtx.clearRect(0, 0, width, height)
      rasterCtx.fillStyle = '#ffffff'
      rasterCtx.textAlign = 'left'
      rasterCtx.textBaseline = 'alphabetic'
      rasterCtx.font = `${style.fontWeight} ${fontSize * dpr}px ${style.fontFamily}`
      const metrics = rasterCtx.measureText(children)
      const ascent = metrics.actualBoundingBoxAscent ?? fontSize * 0.8
      const descent = metrics.actualBoundingBoxDescent ?? fontSize * 0.2
      const baseline = (height - (ascent + descent)) / 2 + ascent
      rasterCtx.fillText(children, 0, baseline)

      gl.bindTexture(gl.TEXTURE_2D, texture)
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, raster)
      gl.viewport(0, 0, width, height)
      setShaded(true)
    }

    const start = performance.now()
    const render = () => {
      if (disposed) return
      gl.uniform1f(timeUniform, (performance.now() - start) / 1000)
      gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4)
      frame = requestAnimationFrame(render)
    }

    void document.fonts.ready.then(() => {
      if (disposed) return
      upload()
      render()
    })

    const resizeObserver = new ResizeObserver(() => {
      if (!disposed) upload()
    })
    resizeObserver.observe(text)

    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      resizeObserver.disconnect()
      gl.deleteTexture(texture)
      gl.deleteBuffer(buffer)
      gl.deleteProgram(program)
      gl.deleteShader(vertex)
      gl.deleteShader(fragment)
    }
  }, [children, reduceMotion])

  return (
    <span className={cn('relative inline-block max-w-full', className)}>
      <span
        ref={textRef}
        className={cn(
          'royalty-name-glow relative inline-block max-w-full truncate align-bottom',
          !shaded && NAME_FALLBACK_CLASSES,
          shaded && 'text-transparent',
        )}
      >
        {children}
      </span>
      <canvas
        ref={canvasRef}
        aria-hidden
        className={cn(
          'royalty-name-glow pointer-events-none absolute inset-0 size-full',
          shaded ? 'opacity-100' : 'opacity-0',
        )}
      />
    </span>
  )
}
