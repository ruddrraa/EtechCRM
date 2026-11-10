import { useOrganization } from '../../features/organization/OrganizationContext'

type BrandLogoProps = {
  size?: 'sidebar' | 'login' | 'compact' | 'collapsed'
  customSrc?: string
}

const sizes = {
  sidebar: 'brand-logo-sidebar',
  login: 'brand-logo-login',
  compact: 'brand-logo-compact',
  collapsed: 'brand-logo-collapsed',
}

export function BrandLogo({ size = 'compact', customSrc }: BrandLogoProps) {
  const { organization } = useOrganization()

  // Login page always displays vendor branding as per Requirement 4
  if (size === 'login') {
    return (
      <img
        className={`brand-logo ${sizes[size]}`}
        src="/assets/excel-technologies-logo.png"
        alt="Excel Technologies & Services"
      />
    )
  }

  // Dynamic organization branding for authenticated workspace
  if (size === 'collapsed') {
    const src = customSrc || organization.collapsedLogo || '/assets/excel-collapsed-logo.png'
    return (
      <img
        className={`brand-logo ${sizes[size]}`}
        src={src}
        alt={organization.name}
        onError={(e) => {
          // Fallback if custom image fails to load
          e.currentTarget.src = '/assets/excel-collapsed-logo.png'
        }}
      />
    )
  }

  const src = customSrc || organization.expandedLogo || '/assets/excel-technologies-logo.png'
  return (
    <img
      className={`brand-logo ${sizes[size]}`}
      src={src}
      alt={organization.name}
      onError={(e) => {
        // Fallback if custom image fails to load
        e.currentTarget.src = '/assets/excel-technologies-logo.png'
      }}
    />
  )
}
