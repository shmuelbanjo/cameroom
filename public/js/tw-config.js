/* Shared Tailwind config — Analog Script design system */
tailwind.config = {
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        surface: '#f9f9f9',
        'surface-dim': '#dadada',
        'surface-bright': '#f9f9f9',
        'surface-container-lowest': '#ffffff',
        'surface-container-low': '#f4f3f3',
        'surface-container': '#eeeeee',
        'surface-container-high': '#e8e8e8',
        'surface-container-highest': '#e2e2e2',
        'surface-variant': '#e2e2e2',
        'on-surface': '#1a1c1c',
        'on-surface-variant': '#4c4546',
        'inverse-surface': '#2f3131',
        'inverse-on-surface': '#f1f1f1',
        outline: '#7e7576',
        'outline-variant': '#cfc4c5',
        primary: '#000000',
        'on-primary': '#ffffff',
        'primary-container': '#1b1b1b',
        'on-primary-container': '#848484',
        'inverse-primary': '#c6c6c6',
        secondary: '#5d5f5f',
        'on-secondary': '#ffffff',
        'secondary-container': '#dcdddd',
        'on-secondary-container': '#5f6161',
        tertiary: '#000000',
        'on-tertiary': '#ffffff',
        background: '#f9f9f9',
        'on-background': '#1a1c1c',
        error: '#ba1a1a',
        'on-error': '#ffffff',
        'error-container': '#ffdad6'
      },
      borderRadius: {
        DEFAULT: '0.125rem',
        lg: '0.25rem',
        xl: '0.5rem',
        full: '9999px'
      },
      spacing: {
        unit: '4px',
        gutter: '16px',
        'margin-mobile': '20px',
        'stack-sm': '8px',
        'stack-md': '24px',
        'stack-lg': '40px'
      },
      fontFamily: {
        'headline-lg':        ['Bricolage Grotesque'],
        'headline-lg-mobile': ['Bricolage Grotesque'],
        'headline-md':        ['Bricolage Grotesque'],
        'stamp-accent':       ['Bricolage Grotesque'],
        'body-lg':            ['Inter'],
        'body-md':            ['Inter'],
        'label-md':           ['Courier Prime'],
        'label-sm':           ['Courier Prime']
      },
      fontSize: {
        'headline-lg':        ['36px', { lineHeight: '1.1', fontWeight: '800', letterSpacing: '-0.04em' }],
        'headline-lg-mobile': ['28px', { lineHeight: '1.1', fontWeight: '800' }],
        'headline-md':        ['24px', { lineHeight: '1.2', fontWeight: '700' }],
        'body-lg':            ['18px', { lineHeight: '1.6', fontWeight: '400' }],
        'body-md':            ['16px', { lineHeight: '1.5', fontWeight: '400' }],
        'label-md':           ['14px', { lineHeight: '1.4', fontWeight: '400', letterSpacing: '0.02em' }],
        'label-sm':           ['12px', { lineHeight: '1.2', fontWeight: '700' }],
        'stamp-accent':       ['12px', { lineHeight: '1',   fontWeight: '800' }]
      }
    }
  }
};
