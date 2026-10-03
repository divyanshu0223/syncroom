import React from 'react';

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'outline' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  leftIcon,
  rightIcon,
  disabled,
  className = '',
  ...props
}) => {
  const baseStyles =
    'relative inline-flex items-center justify-center font-medium tracking-tight select-none transition-all duration-150 ease-out focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:ring-offset-neutral-950 disabled:opacity-50 disabled:pointer-events-none active:scale-[0.98] whitespace-nowrap';

  const sizeStyles = {
    sm: 'text-xs px-3 py-1.5 min-h-[36px] rounded-lg gap-1.5',
    md: 'text-sm px-4 py-2 min-h-[42px] rounded-xl gap-2',
    lg: 'text-base px-6 py-3 min-h-[48px] rounded-xl gap-2.5 font-semibold',
  };

  const variantStyles = {
    primary:
      'bg-amber-400 hover:bg-amber-300 text-neutral-950 font-semibold shadow-md shadow-amber-400/20 hover:shadow-amber-400/30 focus-visible:ring-amber-400',
    secondary:
      'bg-neutral-800 hover:bg-neutral-700 text-neutral-100 border border-neutral-700/60 focus-visible:ring-neutral-400',
    outline:
      'bg-transparent hover:bg-neutral-800/60 text-neutral-300 hover:text-white border border-neutral-700 hover:border-neutral-500 focus-visible:ring-neutral-400',
    ghost:
      'bg-transparent hover:bg-neutral-800/60 text-neutral-400 hover:text-neutral-100 focus-visible:ring-neutral-400',
    danger:
      'bg-red-500/10 hover:bg-red-500/20 text-red-400 hover:text-red-300 border border-red-500/30 focus-visible:ring-red-400',
  };

  return (
    <button
      disabled={disabled || isLoading}
      className={`${baseStyles} ${sizeStyles[size]} ${variantStyles[variant]} ${className}`}
      {...props}
    >
      {isLoading ? (
        <>
          <svg
            className="animate-spin -ml-1 mr-2 h-4 w-4 text-current"
            xmlns="http://www.w3.org/2000/svg"
            fill="none"
            viewBox="0 0 24 24"
          >
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span>Processing...</span>
        </>
      ) : (
        <>
          {leftIcon && <span className="shrink-0">{leftIcon}</span>}
          <span className="truncate">{children}</span>
          {rightIcon && <span className="shrink-0">{rightIcon}</span>}
        </>
      )}
    </button>
  );
};
