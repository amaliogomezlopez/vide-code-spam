import { expect, test } from '@playwright/test'

const API = 'http://127.0.0.1:8000/api'
const SHELL = process.platform === 'win32' ? 'cmd.exe' : 'bash'
const MARKER = 'VIBE_E2E_MARKER'

async function createAgent(request: import('@playwright/test').APIRequestContext, id: string) {
  const response = await request.post(`${API}/agents`, {
    data: { id, name: `E2E ${id}`, command: SHELL, cwd: process.cwd(), autostart: true },
  })
  expect(response.ok(), await response.text()).toBeTruthy()
}

test.afterEach(async ({ request }) => {
  await request.delete(`${API}/agents`)
})

test('opens a terminal, streams output and keeps it across a Git filter', async ({
  page,
  request,
}) => {
  await createAgent(request, 'e2e-one')
  await page.goto('/')

  const card = page.locator('.terminal-card').first()
  await expect(card).toBeVisible()
  // Scoped to the header: the agent name also appears inside the terminal's own
  // connection banners, which would make a bare text match ambiguous.
  await expect(card.locator('.terminal-title-meta strong')).toHaveText('E2E e2e-one')

  // React StrictMode remounts the terminal once in development, and keystrokes
  // sent while that socket is down are dropped. Rather than guess how long the
  // reconnect takes on a loaded machine, keep sending the command until the
  // shell echoes it back; an extra `echo` is harmless.
  const rows = card.locator('.xterm-rows')
  await expect
    .poll(
      async () => {
        await card.locator('.terminal-surface').click()
        await page.keyboard.type(`echo ${MARKER}`)
        await page.keyboard.press('Enter')
        await page.waitForTimeout(1500)
        return (await rows.innerText()).includes(MARKER)
      },
      { timeout: 45_000, intervals: [500] }
    )
    .toBe(true)

  // Reloading reconnects the WebSocket: the backend replays the scrollback, so
  // the history must still be there instead of an empty screen.
  await page.reload()
  await expect(page.locator('.terminal-card .xterm-rows').first()).toContainText(MARKER, {
    timeout: 30_000,
  })
})

test('warns when two terminals share one working tree', async ({ page, request }) => {
  await createAgent(request, 'e2e-a')
  await createAgent(request, 'e2e-b')
  await page.goto('/')

  await expect(page.locator('.terminal-card')).toHaveCount(2)
  // The repository root of this checkout is a Git repository, so both terminals
  // land in the same worktree and the shared-checkout warning must appear.
  await expect(page.getByText(/share one checkout|have more than one terminal/)).toBeVisible({
    timeout: 20_000,
  })
})

test('sidebar exposes every Git view', async ({ page, request }) => {
  await createAgent(request, 'e2e-sidebar')
  await page.goto('/')

  const tablist = page.getByRole('tablist', { name: 'Git views' })
  await expect(tablist).toBeVisible()
  for (const label of ['Repos', 'Changes', 'Commits', 'Integrate', 'Conflicts', 'Worktrees']) {
    await expect(tablist.getByRole('tab', { name: new RegExp(label) })).toBeVisible()
  }

  await tablist.getByRole('tab', { name: /Worktrees/ }).click()
  await expect(page.getByText(/worktree/i).first()).toBeVisible()
})
