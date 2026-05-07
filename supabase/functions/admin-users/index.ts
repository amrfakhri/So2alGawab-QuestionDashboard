import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

function err(message: string, status: number) {
  return new Response(JSON.stringify({ error: message }), {
    status,
    headers: { ...cors, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  try {
    // ── 1. Verify caller is authenticated ──────────────────────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return err('Missing authorization header', 401)

    const caller = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_ANON_KEY')!,
      { global: { headers: { Authorization: authHeader } } },
    )
    const { data: { user }, error: authErr } = await caller.auth.getUser()
    if (authErr || !user) return err('Unauthorized', 401)

    // ── 2. Verify caller is super_admin ────────────────────────────────────
    const { data: roleRow } = await caller
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single()

    if (roleRow?.role !== 'super_admin') return err('Forbidden: super_admin only', 403)

    // ── 3. Admin client (service role — server-side only) ──────────────────
    const admin = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      { auth: { autoRefreshToken: false, persistSession: false } },
    )

    const body = await req.json()
    const { action } = body

    // ── 4. Dispatch ────────────────────────────────────────────────────────
    switch (action) {

      case 'listUsers': {
        const { data: authData, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 })
        if (listErr) throw listErr

        const { data: roles } = await admin.from('user_roles').select('*')
        const roleMap: Record<string, { role: string; full_name: string }> = {}
        ;(roles || []).forEach((r: any) => { roleMap[r.user_id] = r })

        const users = authData.users.map((u: any) => ({
          id:              u.id,
          email:           u.email ?? '',
          full_name:       roleMap[u.id]?.full_name ?? u.user_metadata?.full_name ?? '',
          role:            roleMap[u.id]?.role ?? 'pending',
          created_at:      u.created_at,
          last_sign_in_at: u.last_sign_in_at ?? null,
          disabled:        u.banned_until ? new Date(u.banned_until) > new Date() : false,
          confirmed:       !!u.confirmed_at,
        }))

        return json({ users })
      }

      case 'createUser': {
        const { email, password, full_name, role } = body
        if (!email || !password) return err('email and password are required', 400)

        const { data, error: createErr } = await admin.auth.admin.createUser({
          email,
          password,
          email_confirm: true,
          user_metadata: { full_name: full_name ?? '' },
        })
        if (createErr) throw createErr

        await admin.from('user_roles').upsert({
          user_id:   data.user.id,
          email:     data.user.email,
          full_name: full_name ?? '',
          role:      role ?? 'viewer',
        })

        return json({ user: data.user })
      }

      case 'updateUser': {
        const { userId, full_name, role } = body
        if (!userId) return err('userId required', 400)

        if (full_name !== undefined) {
          await admin.auth.admin.updateUserById(userId, {
            user_metadata: { full_name },
          })
        }

        const patch: Record<string, unknown> = {}
        if (full_name !== undefined) patch.full_name = full_name
        if (role      !== undefined) patch.role      = role
        if (Object.keys(patch).length) {
          await admin.from('user_roles').update(patch).eq('user_id', userId)
        }

        return json({ success: true })
      }

      case 'disableUser': {
        const { userId } = body
        if (!userId)            return err('userId required', 400)
        if (userId === user.id) return err('Cannot disable your own account', 400)

        const { error: banErr } = await admin.auth.admin.updateUserById(userId, {
          ban_duration: '876000h',
        })
        if (banErr) throw banErr
        return json({ success: true })
      }

      case 'enableUser': {
        const { userId } = body
        if (!userId) return err('userId required', 400)

        const { error: unbanErr } = await admin.auth.admin.updateUserById(userId, {
          ban_duration: 'none',
        })
        if (unbanErr) throw unbanErr
        return json({ success: true })
      }

      case 'deleteUser': {
        const { userId } = body
        if (!userId)            return err('userId required', 400)
        if (userId === user.id) return err('Cannot delete your own account', 400)

        await admin.from('user_roles').delete().eq('user_id', userId)
        const { error: delErr } = await admin.auth.admin.deleteUser(userId)
        if (delErr) throw delErr
        return json({ success: true })
      }

      case 'resetPassword': {
        const { email } = body
        if (!email) return err('email required', 400)

        const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
          type:  'recovery',
          email,
        })
        if (linkErr) throw linkErr
        return json({ link: (linkData as any)?.properties?.action_link ?? null })
      }

      default:
        return err(`Unknown action: ${action}`, 400)
    }

  } catch (e: any) {
    console.error('admin-users error:', e)
    const status = /forbidden/i.test(e.message) ? 403
                 : /unauthorized/i.test(e.message) ? 401
                 : 500
    return err(e.message ?? 'Internal server error', status)
  }
})
