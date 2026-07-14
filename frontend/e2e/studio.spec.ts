import { createServer, type Server } from 'node:http'
import { test, expect } from '@playwright/test'

const image = 'iVBORw0KGgoAAAANSUhEUgAAAEAAAAAkCAIAAAC2bqvFAAAAVklEQVR4nNXOQREAIAzAsFIvmEME2hGxB9coyNr3UCZxEidxEidxEidxEidxEidxEidxEidxEidxEidxEidxEidxEidxEidxEidxEidxEidxEufvwNQDcIkBVQ31/UQAAAAASUVORK5CYII='
let upstream: Server

test.beforeAll(async () => {
  upstream = createServer((request, response) => {
    response.setHeader('Content-Type', 'application/json')
    if (request.url === '/v1/models') response.end(JSON.stringify({ data: [{ id: 'gpt-image-2' }, { id: 'gpt-5-mini' }] }))
    else if (request.url === '/v1/images/generations') response.end(JSON.stringify({ data: [{ b64_json: image }] }))
    else if (request.url === '/v1/responses') response.end(JSON.stringify({ output_text: '优化后的青绿色构图提示词' }))
    else { response.statusCode = 404; response.end(JSON.stringify({ error: 'not found' })) }
  })
  await new Promise<void>(resolve => upstream.listen(9797, '127.0.0.1', resolve))
})

test.afterAll(async () => { await new Promise<void>(resolve => upstream.close(() => resolve())) })

test('registers, configures an upstream, generates, downloads, and remains responsive', async ({ page }) => {
  const username = `user${Date.now()}`
  await page.goto('/')
  await page.getByRole('button', { name: '没有账户？立即注册' }).click()
  await page.getByLabel('用户名').fill(username)
  await page.getByLabel('密码').fill('secure-password')
  await page.getByRole('button', { name: '注册' }).click()
  await expect(page.getByRole('heading', { name: '未命名会话' })).toBeVisible()

  await page.getByRole('button', { name: '打开设置' }).click()
  await page.getByLabel('名称').fill('本地模拟上游')
  await page.getByLabel('中转站地址').fill('http://127.0.0.1:9797')
  await page.getByLabel('API Key').fill('test-key')
  await page.getByRole('button', { name: '添加并获取模型' }).click()
  await expect(page.getByText('2 个模型')).toBeVisible()
  await page.getByRole('button', { name: '关闭设置' }).last().click()

  await page.getByPlaceholder('描述你想生成的图片').fill('青绿色的几何构图')
  await page.getByRole('button', { name: '生成图片' }).click()
  await expect(page.getByAltText('生成结果')).toBeVisible()
  await expect(page.getByRole('link', { name: '下载图片' })).toHaveAttribute('href', /download/)
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/studio-light-desktop.png', fullPage: true })

  await page.getByRole('button', { name: '切换主题' }).click()
  await page.getByRole('menuitem', { name: '深色' }).click()
  await page.screenshot({ path: 'test-results/studio-dark-desktop.png', fullPage: true })

  await page.setViewportSize({ width: 390, height: 844 })
  await expect(page.getByAltText('生成结果')).toBeVisible()
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true)
  await page.screenshot({ path: 'test-results/studio-dark-mobile.png', fullPage: true })
})

