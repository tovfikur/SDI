import { NavLink } from 'react-router-dom';
import { Icon } from './Icon';
import type { IconDefinition } from './Icon';

export interface SubNavItem {
  to: string;
  label: string;
  icon?: IconDefinition;
}

export function SubNav({ items, basePath }: { items: SubNavItem[]; basePath: string }) {
  return (
    <div className="desktop-tab-bar subnav-bar">
      {items.map((item) => {
        const isIndex = item.to === '';
        const to = isIndex ? basePath : `${basePath}/${item.to}`;
        return (
          <NavLink
            key={item.to}
            to={to}
            end={isIndex}
            preventScrollReset
            className={({ isActive }) => `tab-btn-sleek ${isActive ? 'active' : ''}`}
          >
            {item.icon && (
              <span className="tab-icon">
                <Icon icon={item.icon} size="xs" />
              </span>
            )}
            {item.label}
          </NavLink>
        );
      })}
    </div>
  );
}
