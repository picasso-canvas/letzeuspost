// The base layout every email uses (§23 Onboarding emails): short, plain, with one button. The plain-text version is
// made from the same render (`renderTemplate` in index.ts), so the two never say different things. Colours are
// DESIGN.md's tokens, written out: email clients don't read the app's CSS.
import {
  Body,
  Button,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Preview,
  Text,
} from '@react-email/components';

const colors = {
  background: '#F7F6F4',
  card: '#FFFFFF',
  foreground: '#1C1A17',
  muted: '#5B5750',
  primary: '#F5B301',
  border: '#E4E2DD',
} as const;

const font = 'Inter, -apple-system, "Segoe UI", Roboto, "Noto Sans Bengali", sans-serif';

export interface LayoutProps {
  /** The line inboxes show next to the subject. */
  readonly preview: string;
  readonly heading: string;
  readonly paragraphs: readonly string[];
  /** The email's one button (§23). */
  readonly button: { readonly label: string; readonly href: string };
  readonly lang?: 'en' | 'bn';
}

export function Layout({ preview, heading, paragraphs, button, lang = 'en' }: LayoutProps) {
  return (
    <Html lang={lang}>
      <Head />
      <Preview>{preview}</Preview>
      <Body style={{ backgroundColor: colors.background, fontFamily: font, margin: 0 }}>
        <Container
          style={{
            backgroundColor: colors.card,
            border: `1px solid ${colors.border}`,
            borderRadius: 8,
            margin: '32px auto',
            maxWidth: 520,
            padding: 32,
          }}
        >
          <Heading as="h1" style={{ color: colors.foreground, fontSize: 22, margin: '0 0 16px' }}>
            {heading}
          </Heading>
          {paragraphs.map((paragraph, index) => (
            <Text
              key={index}
              style={{
                color: colors.foreground,
                fontSize: 16,
                lineHeight: '24px',
                margin: '0 0 16px',
              }}
            >
              {paragraph}
            </Text>
          ))}
          <Button
            href={button.href}
            style={{
              backgroundColor: colors.primary,
              borderRadius: 6,
              color: colors.foreground,
              display: 'inline-block',
              fontSize: 16,
              fontWeight: 600,
              padding: '12px 20px',
              textDecoration: 'none',
            }}
          >
            {button.label}
          </Button>
          <Hr style={{ borderColor: colors.border, margin: '32px 0 16px' }} />
          <Text style={{ color: colors.muted, fontSize: 13, margin: 0 }}>LetZeusPost</Text>
        </Container>
      </Body>
    </Html>
  );
}
