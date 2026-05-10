import V3MApp from '@/components/aftercart-v3m/V3MApp';

export const metadata = {
  title: 'AfterCart V3M — Mobile side-by-side',
};

// Force a phone-width viewport so the mobile demo reads correctly on all
// devices. Desktop visitors still see a phone-shaped frame (handled in V3MApp's
// .v3m-shell CSS).
export const viewport = {
  width: 'device-width',
  initialScale: 1,
};

export default function V3MPage() {
  return <V3MApp />;
}
