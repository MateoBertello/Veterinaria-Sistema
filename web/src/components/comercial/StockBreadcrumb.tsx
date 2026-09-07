import { Link, useInRouterContext } from "react-router-dom";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "../ui/breadcrumb.tsx";

export interface StockBreadcrumbItem {
  label: string;
  href?: string;
}

interface StockBreadcrumbProps {
  items: StockBreadcrumbItem[];
  className?: string;
}

function NavAnchor({ href, children }: { href: string; children: React.ReactNode }) {
  const inRouter = useInRouterContext();
  if (inRouter) {
    return <Link to={href}>{children}</Link>;
  }
  return <a href={href}>{children}</a>;
}

export function StockBreadcrumb({ items, className }: StockBreadcrumbProps) {
  return (
    <Breadcrumb className={className}>
      <BreadcrumbList>
        <BreadcrumbItem>
          <BreadcrumbLink asChild>
            <NavAnchor href="/stock">Stock</NavAnchor>
          </BreadcrumbLink>
        </BreadcrumbItem>
        {items.map((item, index) => {
          const esUltimo = index === items.length - 1;
          return (
            <div key={`${item.label}-${index}`} className="contents">
              <BreadcrumbSeparator />
              <BreadcrumbItem>
                {esUltimo || !item.href ? (
                  <BreadcrumbPage>{item.label}</BreadcrumbPage>
                ) : (
                  <BreadcrumbLink asChild>
                    <NavAnchor href={item.href}>{item.label}</NavAnchor>
                  </BreadcrumbLink>
                )}
              </BreadcrumbItem>
            </div>
          );
        })}
      </BreadcrumbList>
    </Breadcrumb>
  );
}

export default StockBreadcrumb;
