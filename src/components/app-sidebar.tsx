"use client"

import * as React from "react"
import Link from "next/link"
import { usePathname } from "next/navigation"
import {
  Activity,
  Home,
  Settings,
  Zap,
  Circle,
  BookOpen,
  HelpCircle,
  RefreshCw,
  Bug,
  Target,
  Layers,
  FileText,
  BarChart3,
} from "lucide-react"

import { RateLimitSidebar } from "@/components/RateLimitSidebar"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { useConfig } from "@/components/ConfigProvider"
import { useBotStatus } from "@/hooks/useBotStatus"
import dataStore from '@/lib/services/dataStore'
import { VersionChecker } from '@/components/VersionChecker'

const navigation = [
  {
    title: "Dashboard",
    icon: Home,
    href: "/",
  },
  {
    title: "Configuration",
    icon: Settings,
    href: "/config",
  },
  {
    title: "Discovery",
    icon: BarChart3,
    href: "/discovery",
  },
  {
    title: "Analytics",
    icon: Activity,
    href: "/analytics",
  },
  {
    title: "Tranches",
    icon: Layers,
    href: "/tranches",
  },
  {
    title: "Optimizer",
    icon: Target,
    href: "/optimizer",
  },
  {
    title: "Wiki & Help",
    icon: BookOpen,
    href: "/wiki",
  },
  {
    title: "System Logs",
    icon: FileText,
    href: "/logs",
  },
  {
    title: "Error Logs",
    icon: Bug,
    href: "/errors",
  },
]


export function AppSidebar() {
  const pathname = usePathname()
  const { config } = useConfig()
  const { status, connectionState } = useBotStatus()
  const [positions, setPositions] = React.useState<any[]>([])
  const [isMounted, setIsMounted] = React.useState(false)
  const isPaperMode = config?.global?.paperMode

  // Track client-side mount to prevent hydration mismatch
  React.useEffect(() => {
    setIsMounted(true)
  }, [])

  // Load positions and listen for updates
  React.useEffect(() => {
    // Load initial positions from data store
    dataStore.fetchPositions()
      .then(data => setPositions(data))
      .catch(error => console.error('[AppSidebar] Failed to load positions:', error))

    // Subscribe to position updates from data store
    const handlePositionsUpdate = (data: any[]) => {
      setPositions(data)
    }

    dataStore.on('positions:update', handlePositionsUpdate)

    return () => {
      dataStore.off('positions:update', handlePositionsUpdate)
    }
  }, [])


  const getStatusColor = () => {
    if (connectionState === 'live') {
      return status?.isRunning ? 'bg-green-500' : 'bg-emerald-400';
    }
    if (connectionState === 'degraded') return 'bg-amber-500';
    return 'bg-slate-400';
  }

  const getStatusText = () => {
    if (connectionState === 'live') return status?.isRunning ? 'Live' : 'Connected'
    if (connectionState === 'degraded') return 'Degraded'
    return 'Offline'
  }

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2 px-2 py-1.5">
          <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary">
            <Zap className="h-4 w-4 text-primary-foreground" />
          </div>
          <div className="flex flex-col">
            <span className="text-sm font-semibold">Aster Hunter</span>
            <Badge variant={isPaperMode ? "secondary" : "default"} className="w-fit text-xs">
              {isPaperMode ? "Paper Mode" : "Live Trading"}
            </Badge>
          </div>
        </div>
      </SidebarHeader>

      <SidebarContent>
        {/* Navigation */}
        <SidebarGroup>
          <SidebarGroupLabel>Navigation</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {navigation.map((item) => (
                <SidebarMenuItem key={item.title}>
                  <SidebarMenuButton
                    asChild
                    isActive={isMounted ? pathname === item.href : false}
                    suppressHydrationWarning
                  >
                    <Link href={item.href} suppressHydrationWarning>
                      <item.icon className="h-4 w-4" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator className="my-2" />

        {/* Bot Status Section */}
        <SidebarGroup>
          <SidebarGroupLabel>Bot Status</SidebarGroupLabel>
          <SidebarGroupContent>
            <div className="space-y-2.5 px-2">
              {/* Connection Status */}
              <div className="flex items-center justify-between">
                <span className="text-sm text-muted-foreground">Status</span>
                <div className="flex items-center gap-2">
                  <Circle className={`h-2 w-2 fill-current ${getStatusColor()} ${connectionState === 'live' && status?.isRunning ? 'animate-pulse' : ''}`} />
                  <span className="text-sm font-medium">{getStatusText()}</span>
                </div>
              </div>

              {/* Mode */}
              {status && (
                <>
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Mode</span>
                    <Badge
                      variant={status.paperMode ? "secondary" : "default"}
                      className="h-5 px-2 text-xs font-medium"
                    >
                      {status.paperMode ? "Paper" : "Live"}
                    </Badge>
                  </div>

                  {/* Positions */}
                  <div className="flex items-center justify-between">
                    <span className="text-sm text-muted-foreground">Positions</span>
                    <span className="text-sm font-medium">{positions.length}</span>
                  </div>
                </>
              )}

              {/* Rate Limits */}
              {connectionState !== 'offline' && (
                <div className="mt-2 pt-2 border-t border-sidebar-border">
                  <RateLimitSidebar />
                </div>
              )}
            </div>
          </SidebarGroupContent>
        </SidebarGroup>

        <SidebarSeparator className="my-2" />

        {/* Help Section */}
        <SidebarGroup>
          <SidebarGroupLabel>Help & Resources</SidebarGroupLabel>
          <SidebarGroupContent>
            <div className="space-y-1 px-2">
              <Button
                variant="ghost"
                size="sm"
                className="w-full justify-start h-8"
                onClick={() => {
                  // Trigger tutorial restart
                  const event = new CustomEvent('restart-tutorial');
                  window.dispatchEvent(event);
                }}
              >
                <RefreshCw className="mr-2 h-4 w-4" />
                Restart Tutorial
              </Button>
              <Link href="/wiki/getting-started" suppressHydrationWarning>
                <Button
                  variant="ghost"
                  size="sm"
                  className="w-full justify-start h-8"
                >
                  <HelpCircle className="mr-2 h-4 w-4" />
                  Getting Started
                </Button>
              </Link>
            </div>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>

      <SidebarFooter>
        <div className="space-y-1">
          {/* Connection Status */}
              <div className="px-2 py-1.5 text-xs text-muted-foreground">
                <div className="flex items-center justify-between">
                  <span>Connection</span>
                  <div className="flex items-center gap-1">
                    {connectionState === 'live' ? (
                      <>
                        <Activity className="h-3 w-3 text-green-500 animate-pulse" />
                        <span className="text-green-500">Live</span>
                      </>
                    ) : connectionState === 'degraded' ? (
                      <>
                        <Activity className="h-3 w-3 text-amber-500" />
                        <span className="text-amber-500">Degraded</span>
                      </>
                    ) : (
                      <>
                        <Activity className="h-3 w-3 text-muted-foreground" />
                        <span className="text-muted-foreground">Offline</span>
                      </>
                    )}
                  </div>
                </div>
                {connectionState === 'degraded' && (
                  <div className="mt-1 text-[10px] text-muted-foreground">
                    Using the last known bot snapshot
                  </div>
                )}
              </div>

          {/* Version Status */}
          <VersionChecker />
        </div>
      </SidebarFooter>

      <SidebarRail />
    </Sidebar>
  )
}
