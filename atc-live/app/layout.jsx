import './globals.css';

export const metadata = {
  title: 'ATC Live — Praha LKPR',
  description: 'Live Air Traffic Control Radio Simulator for Prague Airport',
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
