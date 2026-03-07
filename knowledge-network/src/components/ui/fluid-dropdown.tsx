"use client"

import * as React from "react"
import { createPortal } from "react-dom"
import { AnimatePresence, MotionConfig, motion } from "framer-motion"
import { ChevronDown, Layers, type LucideIcon, Shirt, Briefcase, Smartphone, Home } from "lucide-react"

import { cn } from "@/lib/utils"

type DropdownIcon = LucideIcon

export interface FluidDropdownOption {
  value: string
  label: string
  icon?: DropdownIcon
  color?: string
  disabled?: boolean
  dividerBefore?: boolean
}

interface FluidDropdownProps {
  options: FluidDropdownOption[]
  value: string
  onValueChange: (value: string) => void
  placeholder?: string
  ariaLabel?: string
  disabled?: boolean
  className?: string
  triggerClassName?: string
  menuClassName?: string
  defaultIcon?: DropdownIcon
}

interface ClickAwayRefs {
  triggerRef: React.RefObject<HTMLElement | null>
  menuRef: React.RefObject<HTMLElement | null>
}

interface MenuPosition {
  left: number
  top: number
  width: number
  openUpward: boolean
  maxHeight: number
}

function useClickAway(
  refs: ClickAwayRefs,
  handler: (event: MouseEvent | TouchEvent) => void
) {
  React.useEffect(() => {
    const listener = (event: MouseEvent | TouchEvent) => {
      const target = event.target as Node | null
      if (!target) return

      if (refs.triggerRef.current?.contains(target)) return
      if (refs.menuRef.current?.contains(target)) return
      handler(event)
    }

    document.addEventListener("mousedown", listener)
    document.addEventListener("touchstart", listener)

    return () => {
      document.removeEventListener("mousedown", listener)
      document.removeEventListener("touchstart", listener)
    }
  }, [handler, refs.menuRef, refs.triggerRef])
}

function IconWrapper({
  icon: Icon,
  isHovered,
  color,
}: {
  icon: DropdownIcon
  isHovered: boolean
  color: string
}) {
  return (
    <motion.div
      className="relative mr-2 flex h-4 w-4 items-center justify-center"
      initial={false}
      animate={isHovered ? { scale: 1.14 } : { scale: 1 }}
      transition={{ duration: 0.18 }}
    >
      <Icon className="h-4 w-4" />
      {isHovered && (
        <motion.div
          className="absolute inset-0"
          style={{ color }}
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.16 }}
        >
          <Icon className="h-4 w-4" strokeWidth={2.2} />
        </motion.div>
      )}
    </motion.div>
  )
}

function computeMenuPosition(trigger: HTMLElement): MenuPosition {
  const rect = trigger.getBoundingClientRect()
  const viewportPadding = 12
  const below = window.innerHeight - rect.bottom - viewportPadding
  const above = rect.top - viewportPadding
  const openUpward = below < 240 && above > below
  const maxHeight = Math.max(160, (openUpward ? above : below) - 8)
  const width = Math.max(rect.width, 180)
  const left = Math.min(
    Math.max(viewportPadding, rect.left),
    window.innerWidth - width - viewportPadding
  )

  return {
    left,
    top: openUpward ? rect.top - 8 : rect.bottom + 8,
    width,
    openUpward,
    maxHeight,
  }
}

export function FluidDropdown({
  options,
  value,
  onValueChange,
  placeholder = "Select an option",
  ariaLabel,
  disabled = false,
  className,
  triggerClassName,
  menuClassName,
  defaultIcon = Layers,
}: FluidDropdownProps) {
  const [isOpen, setIsOpen] = React.useState(false)
  const [hoveredValue, setHoveredValue] = React.useState<string | null>(null)
  const [mounted, setMounted] = React.useState(false)
  const [menuPosition, setMenuPosition] = React.useState<MenuPosition | null>(null)
  const triggerRef = React.useRef<HTMLButtonElement>(null)
  const menuRef = React.useRef<HTMLDivElement>(null)
  const highlightId = React.useId()

  const selectedOption = React.useMemo(
    () => options.find((option) => option.value === value),
    [options, value]
  )

  const updatePosition = React.useCallback(() => {
    if (!triggerRef.current) return
    setMenuPosition(computeMenuPosition(triggerRef.current))
  }, [])

  React.useEffect(() => {
    setMounted(true)
  }, [])

  useClickAway(
    {
      triggerRef,
      menuRef,
    },
    () => setIsOpen(false)
  )

  React.useEffect(() => {
    if (!isOpen) return

    updatePosition()

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setIsOpen(false)
      }
    }

    const handleViewportChange = () => updatePosition()

    window.addEventListener("resize", handleViewportChange)
    window.addEventListener("scroll", handleViewportChange, true)
    document.addEventListener("keydown", handleEscape)

    return () => {
      window.removeEventListener("resize", handleViewportChange)
      window.removeEventListener("scroll", handleViewportChange, true)
      document.removeEventListener("keydown", handleEscape)
    }
  }, [isOpen, updatePosition])

  const selectedIcon = selectedOption?.icon ?? defaultIcon
  const selectedColor = selectedOption?.color ?? "#45B7D1"

  return (
    <MotionConfig reducedMotion="user">
      <div className={cn("relative", className)}>
        <button
          type="button"
          ref={triggerRef}
          onClick={() => {
            if (disabled) return
            setIsOpen((prev) => !prev)
          }}
          aria-label={ariaLabel}
          aria-expanded={isOpen}
          aria-haspopup="listbox"
          disabled={disabled}
          className={cn(
            "inline-flex h-10 w-full items-center justify-between rounded-xl border border-white/12 bg-[#04060b]/96 px-3 text-sm font-medium text-slate-300 shadow-[0_18px_52px_rgba(0,0,0,0.58)] backdrop-blur-xl transition-all duration-200",
            "hover:border-white/18 hover:bg-[#080b13] hover:text-white",
            "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/45 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950",
            "disabled:pointer-events-none disabled:opacity-55",
            isOpen && "border-cyan-300/28 bg-[#090d16] text-white",
            triggerClassName
          )}
        >
          <span className="flex min-w-0 items-center">
            <IconWrapper icon={selectedIcon} isHovered={false} color={selectedColor} />
            <span className="truncate">{selectedOption?.label ?? placeholder}</span>
          </span>

          <motion.span
            animate={{ rotate: isOpen ? 180 : 0 }}
            transition={{ duration: 0.18 }}
            className="ml-3 flex h-5 w-5 items-center justify-center text-slate-400"
          >
            <ChevronDown className="h-4 w-4" />
          </motion.span>
        </button>

        {mounted &&
          createPortal(
            <AnimatePresence>
              {isOpen && menuPosition && (
                <motion.div
                  className="fixed z-[80]"
                  style={{
                    left: menuPosition.left,
                    top: menuPosition.top,
                    width: menuPosition.width,
                  }}
                  initial={{ opacity: 0, y: menuPosition.openUpward ? 6 : -6 }}
                  animate={{ opacity: 1, y: 0 }}
                  exit={{ opacity: 0, y: menuPosition.openUpward ? 6 : -6 }}
                  transition={{ duration: 0.18, ease: "easeOut" }}
                >
                  <motion.div
                    ref={menuRef}
                    className={cn(
                      "overflow-hidden rounded-2xl border border-white/10 bg-[#03050a]/98 p-1.5 shadow-[0_30px_90px_rgba(0,0,0,0.68)] backdrop-blur-2xl",
                      menuPosition.openUpward && "-translate-y-full",
                      menuClassName
                    )}
                    initial={{ borderRadius: 18, scale: 0.98 }}
                    animate={{ borderRadius: 18, scale: 1 }}
                    exit={{ scale: 0.98 }}
                    transition={{ type: "spring", stiffness: 420, damping: 30, mass: 0.9 }}
                    style={{ maxHeight: menuPosition.maxHeight }}
                    role="listbox"
                    aria-label={ariaLabel}
                  >
                    <div
                      className="overflow-y-auto overscroll-contain py-1 pr-1 [scrollbar-color:rgba(148,163,184,0.45)_transparent] [scrollbar-width:thin]"
                      style={{
                        maxHeight: Math.max(120, menuPosition.maxHeight - 12),
                        WebkitOverflowScrolling: "touch",
                      }}
                    >
                      {options.map((option, index) => {
                        const Icon = option.icon ?? defaultIcon
                        const color = option.color ?? selectedColor
                        const isActive = option.value === value
                        const isHovered = hoveredValue === option.value
                        const showHighlight = isActive || isHovered

                        return (
                          <React.Fragment key={option.value}>
                            {option.dividerBefore && index > 0 && (
                              <div className="mx-3 my-2 border-t border-white/8" />
                            )}
                            <motion.button
                              type="button"
                              onClick={() => {
                                if (option.disabled) return
                                onValueChange(option.value)
                                setIsOpen(false)
                              }}
                              onHoverStart={() => {
                                if (option.disabled) return
                                setHoveredValue(option.value)
                              }}
                              onHoverEnd={() => setHoveredValue(null)}
                              disabled={option.disabled}
                              className={cn(
                                "relative flex w-full items-center rounded-xl px-3.5 py-2.5 text-left text-sm transition-colors duration-150",
                                "focus:outline-none focus-visible:ring-2 focus-visible:ring-cyan-400/35",
                                option.disabled
                                  ? "cursor-not-allowed text-slate-600"
                                  : showHighlight
                                    ? "text-white"
                                    : "text-slate-400"
                              )}
                              whileTap={option.disabled ? undefined : { scale: 0.985 }}
                            >
                              {showHighlight && (
                                <motion.div
                                  layoutId={`${highlightId}-highlight`}
                                  className="absolute inset-0 rounded-xl bg-white/10"
                                  transition={{ type: "spring", stiffness: 420, damping: 34, mass: 0.8 }}
                                />
                              )}
                              <span className="relative z-10 flex min-w-0 items-center">
                                <IconWrapper icon={Icon} isHovered={isHovered} color={color} />
                                <span className="truncate">{option.label}</span>
                              </span>
                            </motion.button>
                          </React.Fragment>
                        )
                      })}
                    </div>
                  </motion.div>
                </motion.div>
              )}
            </AnimatePresence>,
            document.body
          )}
      </div>
    </MotionConfig>
  )
}

const categories: FluidDropdownOption[] = [
  { value: "all", label: "All", icon: Layers, color: "#A06CD5" },
  { value: "lifestyle", label: "Lifestyle", icon: Shirt, color: "#FF6B6B", dividerBefore: true },
  { value: "desk", label: "Desk", icon: Briefcase, color: "#4ECDC4" },
  { value: "tech", label: "Tech", icon: Smartphone, color: "#45B7D1" },
  { value: "home", label: "Home", icon: Home, color: "#F9C74F" },
]

export function Component() {
  const [value, setValue] = React.useState("all")

  return (
    <FluidDropdown
      ariaLabel="Choose a category"
      options={categories}
      value={value}
      onValueChange={setValue}
    />
  )
}
