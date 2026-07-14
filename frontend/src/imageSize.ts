export function validateImageSize(size: string): string {
  const match = /^(\d+)x(\d+)$/.exec(size)
  if (!match) return '图片尺寸格式不正确'
  const width = Number(match[1])
  const height = Number(match[2])
  if (Math.max(width, height) > 3840) return '图片边长不能超过 3840 像素'
  if (width % 16 !== 0 || height % 16 !== 0) return '图片宽高必须是 16 的倍数'
  if (Math.max(width, height) / Math.min(width, height) > 3) return '图片长短边比例不能超过 3:1'
  const pixels = width * height
  if (pixels < 655_360 || pixels > 8_294_400) return '图片总像素需在 655,360 到 8,294,400 之间'
  return ''
}
