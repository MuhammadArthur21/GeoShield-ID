interface IconProps {
  name: string;
  className?: string;
  label?: string;
}

export default function Icon({ name, className = "", label }: IconProps) {
  return <svg className={`gs-icon ${className}`} aria-hidden={label ? undefined : true} role={label ? "img" : undefined} aria-label={label}>
    <use href={`/assets/icons/gs-sprite.svg#gs-${name}`} />
  </svg>;
}
