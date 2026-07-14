import { expect, test } from 'vitest'
import { validateImageSize } from './imageSize'

test('accepts gpt-image-2 compatible custom dimensions', () => {
  expect(validateImageSize('2048x1152')).toBe('')
  expect(validateImageSize('3840x2160')).toBe('')
})

test('explains invalid custom dimensions before generation', () => {
  expect(validateImageSize('1600x900')).toContain('16 的倍数')
  expect(validateImageSize('4096x2048')).toContain('3840')
  expect(validateImageSize('1024x256')).toContain('3:1')
  expect(validateImageSize('512x512')).toContain('总像素')
})
