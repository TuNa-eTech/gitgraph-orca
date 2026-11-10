import type { PluginRequestArgs, PluginRequestOutput, PluginRequests } from 'orca'

/**
 * `orca.plugin.request` with `undefined` fields removed from the input. Orca validates the input
 * as a JSON value and rejects the whole request ("input: Invalid input") when an object has an
 * `undefined` property, which optional fields like `repoPath` produce.
 */
export function request<K extends keyof PluginRequests>(
  name: K,
  ...args: PluginRequestArgs<K>
): Promise<PluginRequestOutput<K>> {
  const [input, ...rest] = args as unknown[]
  const clean = input === undefined ? undefined : JSON.parse(JSON.stringify(input))
  return (orca.plugin.request as (n: K, ...a: unknown[]) => Promise<PluginRequestOutput<K>>)(
    name,
    clean,
    ...rest
  )
}
