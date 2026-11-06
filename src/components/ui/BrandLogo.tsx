type BrandLogoProps = { size?: 'sidebar' | 'login' | 'compact' | 'collapsed' }

const sizes = {
  sidebar: 'brand-logo-sidebar',
  login: 'brand-logo-login',
  compact: 'brand-logo-compact',
  collapsed: 'brand-logo-collapsed',
}

export function BrandLogo({ size = 'compact' }: BrandLogoProps) {
  const source = size === 'collapsed' ? '/assets/excel-collapsed-logo.png' : '/assets/excel-technologies-logo.png'
  return <img className={`brand-logo ${sizes[size]}`} src={source} alt="Excel Technologies & Services" />
}
