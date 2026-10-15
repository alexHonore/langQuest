import { requireStaff } from '@/src/lib/auth/session';
import { StudioShell } from '@/src/components/shell';

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const session = await requireStaff();
  return (
    <StudioShell roles={session.roles} email={session.email}>
      {children}
    </StudioShell>
  );
}
