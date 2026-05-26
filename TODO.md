# TODO

Loose backlog. Not exhaustive, not prioritized.

## E2E test coverage to expand

Current coverage (`e2e/specs/app.e2e.js`): default tab is active + ugoira appears in format dropdown. That's it. Things worth adding, roughly in order of "catches real regressions":

### File loading paths
- [ ] Drag-drop a real file onto the conversion preview area (verify `dragDropEnabled: false` keeps working — easy to silently break by re-enabling)
- [ ] Click the empty preview area triggers the file picker (skip the dialog itself; assert `pick_open_file` is invoked — needs an IPC spy, or wrap the dialog so a fake path can be injected for tests)
- [ ] Load a fixture mp4 end to end, verify frame count matches expected, file-size cell shows non-zero value

### Conversion tab interactions
- [ ] Frame slider, prev/next, play/pause cycle the `currentFrame` correctly
- [ ] Loop checkbox: with it off, play stops at last frame and the play button reverts to ▶
- [ ] Undo: apply mosaic to all frames → undo → state.frames matches originals; undo button greys out when stack empty
- [ ] Switching format hides/shows the right option panels (gif → gif-options visible; ugoira → ugoira-options visible; others → both hidden)

### Ugoira specifics
- [ ] Selecting Ugoira reveals the quality slider, scale dropdown, delay select
- [ ] Setting delay to "custom" shows the custom-ms input
- [ ] 500-frame threshold triggers the confirm dialog (mock `window.confirm`)

### Image-tools tab (currently zero E2E coverage)
- [ ] Undo / redo via Ctrl+Z / Ctrl+Shift+Z
- [ ] Mosaic / blur / text / camera apply flows
- [ ] Selection mode toggle (Tab key, button title text updates)

### Cross-tab / app-level
- [ ] Tab switch preserves state (open file in conversion tab, switch to image-tools, switch back — frames still loaded)
- [ ] Window title is "图片工具"

### Negative paths
- [ ] Loading a non-media file gives a sensible error in the status bar (not a stack trace)
- [ ] Export with no frames loaded is a no-op (export button is disabled — already enforced; add an explicit assertion)

### Infrastructure
- [ ] Run `npm run e2e` in CI on `windows-latest`. Should be cheap: the release build is already cached by the existing build workflow. Either add a step to the same job, or a separate workflow.
- [ ] Tests currently share one app instance per worker (worker-scoped fixture). If we add tests that mutate global state (e.g., load a file, then verify later test sees no file), we'll need either a "reset to initial" helper or a per-test re-spawn. The per-test approach had a CDP socket race the last time we tried — revisit with a per-test random port if we go that direction.

## Other small items

- [ ] `loadVideoFrames` hard-codes 3000-frame limit. Move to a config constant + show the limit in the status bar before loading starts (so user can drop fps before).
- [ ] No way to remove `additionalBrowserArgs: --remote-debugging-port=9222` for production builds. Currently any local user could attach a debugger to the shipped app. For a personal image tool the risk is academic, but document the conditional-build option if we ever ship to others.
- [ ] Conversion tab tool panel: only mosaic + camera. Image-tools tab also has text + blur — could be unified.
