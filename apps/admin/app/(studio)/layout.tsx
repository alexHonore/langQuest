import { requireStaff } from '@/src/lib/auth/session';
import { canAccessSection } from '@/src/lib/auth/roles';
import { loadSetupStatus } from '@/src/lib/setup/status';
import { DeploymentProvider } from '@/src/lib/setup/context';
import { StudioShell } from '@/src/components/shell';

export default async function StudioLayout({ children }: { children: React.ReactNode }) {
  const session = await requireStaff();
  // Public, non-secret deployment facts (cached ~30 s): decide which controls exist, never which are greyed out.
  const setup = await loadSetupStatus();
  return (
    <DeploymentProvider value={{ ...setup, canOpenSetup: canAccessSection(session.roles, 'setup') }}>
      <StudioShell roles={session.roles} email={session.email} setupIncomplete={setup.incomplete}>
        {children}
      </StudioShell>
    </DeploymentProvider>
  );
}
