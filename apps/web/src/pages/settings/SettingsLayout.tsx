import { useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { PageHeader } from '../../components/PageHeader';
import { isAdminUser, useCurrentUser, usePermissions } from '../../auth-context';
import { Icon, Icons } from '../../components/Icon';

export function SettingsLayout(): ReactElement {
  const [softwareOpen, setSoftwareOpen] = useState(true);
  const [payrollOpen, setPayrollOpen] = useState(false);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const location = useLocation();
  const user = useCurrentUser();
  const isAdmin = isAdminUser(user);
  const { can } = usePermissions();

  useEffect(() => {
    setMobileNavOpen(false);
  }, [location.pathname]);

  const isActive = (prefix: string) =>
    location.pathname === prefix || location.pathname.startsWith(`${prefix}/`);

  return (
    <div>
      <PageHeader
        title="System Settings"
        subtitle="Software setup and system activity management."
      />
      <div className="settings-layout">
        <div className="settings-subnav-wrap">
          <button
            className="settings-subnav-mobile-toggle"
            onClick={() => setMobileNavOpen((o) => !o)}
          >
            <span>Settings Menu</span>
            <span className={`nav-group-chevron ${mobileNavOpen ? 'open' : ''}`}>
              <Icon icon={Icons.ChevronDown} size="xs" />
            </span>
          </button>
          <nav className={`settings-subnav ${mobileNavOpen ? 'open' : ''}`}>
            <div
              className={`settings-nav-group ${isActive('/settings/software-setup') ? 'nav-group-active' : ''}`}
            >
              <button
                className="settings-nav-toggle"
                onClick={() => {
                  setSoftwareOpen((o) => !o);
                }}
              >
                <span className="settings-nav-icon">
                  <Icon icon={Icons.Sliders} />
                </span>
                <span className="nav-group-label">Software Setup</span>
                <span className={`nav-group-chevron ${softwareOpen ? 'open' : ''}`}>
                  <Icon icon={Icons.ChevronDown} size="xs" />
                </span>
              </button>
              {softwareOpen && (
                <div className="settings-nav-children">
                  <NavLink
                    to="/settings/software-setup"
                    className={({ isActive: a }) =>
                      a ? 'settings-nav-link active' : 'settings-nav-link'
                    }
                  >
                    Company Profile
                  </NavLink>
                </div>
              )}
            </div>
            <NavLink
              to="/settings/activity-log"
              className={({ isActive: a }) =>
                a ? 'settings-nav-link active' : 'settings-nav-link'
              }
            >
              <span className="settings-nav-icon">
                <Icon icon={Icons.FileLines} />
              </span>
              Activity Log
            </NavLink>
            {can('payroll.view') && (
              <div
                className={`settings-nav-group ${isActive('/settings/payroll-rules') ? 'nav-group-active' : ''}`}
              >
                <button className="settings-nav-toggle" onClick={() => setPayrollOpen((o) => !o)}>
                  <span className="settings-nav-icon">
                    <Icon icon={Icons.Calculator} />
                  </span>
                  <span className="nav-group-label">Payroll</span>
                  <span className={`nav-group-chevron ${payrollOpen ? 'open' : ''}`}>
                    <Icon icon={Icons.ChevronDown} size="xs" />
                  </span>
                </button>
                {payrollOpen && (
                  <div className="settings-nav-children">
                    <NavLink
                      to="/settings/payroll-rules"
                      className={({ isActive: a }) =>
                        a ? 'settings-nav-link active' : 'settings-nav-link'
                      }
                    >
                      Payroll Rules
                    </NavLink>
                    {can('salary_component.view') && (
                      <NavLink
                        to="/settings/salary-components"
                        className={({ isActive: a }) =>
                          a ? 'settings-nav-link active' : 'settings-nav-link'
                        }
                      >
                        Salary Components
                      </NavLink>
                    )}
                    {can('salary_structure.view') && (
                      <NavLink
                        to="/settings/salary-structures"
                        className={({ isActive: a }) =>
                          a ? 'settings-nav-link active' : 'settings-nav-link'
                        }
                      >
                        Salary Structures
                      </NavLink>
                    )}
                  </div>
                )}
              </div>
            )}
            <NavLink
              to="/settings/appearance"
              className={({ isActive: a }) =>
                a ? 'settings-nav-link active' : 'settings-nav-link'
              }
            >
              <span className="settings-nav-icon">
                <Icon icon={Icons.Sun} />
              </span>
              Appearance
            </NavLink>
            {can('geofence.view') && (
              <NavLink
                to="/settings/geofencing"
                className={({ isActive: a }) =>
                  a ? 'settings-nav-link active' : 'settings-nav-link'
                }
              >
                <span className="settings-nav-icon">
                  <Icon icon={Icons.LocationDot} />
                </span>
                Geofencing
              </NavLink>
            )}
            {isAdmin && (
              <div
                className={`settings-nav-group ${isActive('/settings/meta-audit') ? 'nav-group-active' : ''}`}
              >
                <button className="settings-nav-toggle" onClick={() => setAdvancedOpen((o) => !o)}>
                  <span className="settings-nav-icon">
                    <Icon icon={Icons.ShieldHalved} />
                  </span>
                  <span className="nav-group-label">Advanced</span>
                  <span className={`nav-group-chevron ${advancedOpen ? 'open' : ''}`}>
                    <Icon icon={Icons.ChevronDown} size="xs" />
                  </span>
                </button>
                {advancedOpen && (
                  <div className="settings-nav-children">
                    <NavLink
                      to="/settings/meta-audit"
                      className={({ isActive: a }) =>
                        a ? 'settings-nav-link active' : 'settings-nav-link'
                      }
                    >
                      Meta Audit
                    </NavLink>
                  </div>
                )}
              </div>
            )}
          </nav>
        </div>
        <div className="settings-content">
          <Outlet />
        </div>
      </div>
    </div>
  );
}
