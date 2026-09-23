const assert = require('node:assert/strict')
const { readFileSync } = require('node:fs')
const { test } = require('node:test')
const { runInNewContext } = require('node:vm')
const ts = require('typescript')

// The gate's decision rules live in `src/lib/onboarding-gate.ts`. We
// transpile it the same way `auth.test.cjs` / `public-api.test.cjs`
// do — TypeScript transpileModule into CommonJS, run in a vm context
// with stubbed aliases — so the test exercises the real source rather
// than a hand-rolled reimplementation.
const source = readFileSync(require.resolve('../src/lib/onboarding-gate.ts'), 'utf8')
const { outputText } = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 },
})

// Wrapper function: `auth.test.cjs` and `public-api.test.cjs` both
// keep the vm context inside a function so `exports` doesn't collide
// with CommonJS's module-scope `exports` parameter.
function load() {
  const exports = {}
  runInNewContext(outputText, {
    exports,
    console,
    setTimeout,
    clearTimeout,
    require(name) {
      // The module imports `SetupChecks` as a type-only import. The
      // transpile step strips it, but we still provide a stub in case
      // future changes add a value-level import that reaches `@/`.
      if (name === '@/lib/setup-checks') return {}
      throw new Error(`Unexpected import: ${name}`)
    },
  })
  return exports
}

const { decideOnboardingGate } = load()

/**
 * Build a `SetupChecks` shape with the given booleans. We don't need
 * to populate `folderPath` for the gate decision — the function only
 * reads the four boolean fields — but we keep it coherent so any
 * future assertion on `inputs.folderPath` is meaningful.
 */
function checks({ hasKey, hasFolder, hasBaseGame }) {
  return {
    hasKey,
    hasFolder,
    hasBaseGame,
    hasMarker: hasBaseGame,
    folderPath: hasFolder ? 'C:/games/h1z1' : null,
  }
}

test('returns `complete` when key + folder + base game are all present, regardless of the flag', () => {
  // Regression: before the fix, a returning user whose localStorage
  // flag was still `'1'` (they finished the wizard before, or had
  // their state restored) would fall through to Path 2 and get
  // bounced into the wizard when hasBaseGame was true only via the
  // exe fallback. Now the on-disk triple is the source of truth.
  for (const flag of [false, true]) {
    const decision = decideOnboardingGate(flag, checks({
      hasKey: true,
      hasFolder: true,
      hasBaseGame: true,
    }))
    assert.equal(decision.kind, 'complete', `flag=${flag} should yield complete`)
  }
})

test('returns `complete` when the flag is set and key + folder are present, even without base game', () => {
  // The FinishStep only enables Finish when all three are true, so a
  // set flag with key + folder is a strong "they're done" signal. We
  // trust the flag here because re-validating every check on disk
  // would re-block the user on transient IPC errors (see the hook's
  // doc comment for the rationale).
  const decision = decideOnboardingGate(true, checks({
    hasKey: true,
    hasFolder: true,
    hasBaseGame: false,
  }))
  assert.equal(decision.kind, 'complete')
})

test('returns `incomplete` when the flag is set but key is missing', () => {
  // A set flag without a key is more likely a half-finished wizard
  // than a real install. We require the wizard-written inputs to be
  // present before trusting the flag.
  const decision = decideOnboardingGate(true, checks({
    hasKey: false,
    hasFolder: true,
    hasBaseGame: true,
  }))
  assert.equal(decision.kind, 'incomplete')
})

test('returns `incomplete` when the flag is set but folder is missing', () => {
  const decision = decideOnboardingGate(true, checks({
    hasKey: true,
    hasFolder: false,
    hasBaseGame: true,
  }))
  assert.equal(decision.kind, 'incomplete')
})

test('returns `incomplete` when nothing is set', () => {
  const decision = decideOnboardingGate(false, checks({
    hasKey: false,
    hasFolder: false,
    hasBaseGame: false,
  }))
  assert.equal(decision.kind, 'incomplete')
  assert.equal(decision.inputs.hasKey, false)
})

test('returns `complete` for the wiped-flag returning user with a real install (the reported regression)', () => {
  // This is the case from the bug report: a user who finished the
  // wizard once, had their browser state cleared (or reinstalled),
  // and now relaunches with a valid install still on disk. Before
  // the fix the old Path 1 was gated on `!flag`, so a set flag would
  // send them to Path 2 and any flaky hasKey/hasFolder read would
  // strand them inside the wizard. Now the on-disk triple wins.
  const decision = decideOnboardingGate(false, checks({
    hasKey: true,
    hasFolder: true,
    hasBaseGame: true,
  }))
  assert.equal(decision.kind, 'complete')
})

test('exhaustively enumerates all 16 (flag × inputs) combinations', () => {
  // Defensive coverage: every combination yields exactly one of the
  // two decision kinds, and the rules above cover the boundaries.
  // If a future change adds a branch this table will surface it.
  const expected = ({ flag, hasKey, hasFolder, hasBaseGame }) => {
    // Source-of-truth: all three on-disk inputs present → complete.
    if (hasKey && hasFolder && hasBaseGame) return 'complete'
    // Flag-trusted: flag set and wizard-written inputs present.
    if (flag && hasKey && hasFolder) return 'complete'
    return 'incomplete'
  }

  for (const flag of [false, true]) {
    for (const hasKey of [false, true]) {
      for (const hasFolder of [false, true]) {
        for (const hasBaseGame of [false, true]) {
          const decision = decideOnboardingGate(flag, checks({
            hasKey, hasFolder, hasBaseGame,
          }))
          assert.equal(
            decision.kind,
            expected({ flag, hasKey, hasFolder, hasBaseGame }),
            `flag=${flag} key=${hasKey} folder=${hasFolder} base=${hasBaseGame}`,
          )
        }
      }
    }
  }
})

test('passes the inputs through on `incomplete` so the wizard can pre-fill', () => {
  // The hook contract: `incomplete` carries the inputs so the wizard
  // can hydrate its local state and skip steps the user already
  // completed. We verify the decision returns the same object the
  // caller passed in — not a transformed copy.
  const inputs = checks({
    hasKey: true,
    hasFolder: false,
    hasBaseGame: false,
  })
  const decision = decideOnboardingGate(false, inputs)
  assert.equal(decision.kind, 'incomplete')
  assert.equal(decision.inputs, inputs)
})
