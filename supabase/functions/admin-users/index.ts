import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Must match a URL in Supabase Auth → URL Configuration → Redirect URLs
const DEFAULT_REDIRECT = 'https://game.amrfakhri.com/'

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

// Map raw Supabase/GoTrue error messages to user-friendly strings
function friendlyInviteError(raw: string): string {
  const msg = raw.toLowerCase()
  if (msg.includes('already registered') || msg.includes('already been invited') || msg.includes('user already exists')) {
    return 'A user with this email already exists. If they haven\'t activated yet, use "Resend Invite".'
  }
  if (msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('email rate limit')) {
    return 'Too many invite emails sent. Please wait a few minutes before trying again.'
  }
  if (msg.includes('invalid email') || msg.includes('unable to validate email')) {
    return 'The email address is invalid or cannot receive emails.'
  }
  if (msg.includes('redirect') || msg.includes('not allowed')) {
    return 'Invite failed: the redirect URL is not in the Supabase allowed list. Add it in Auth → URL Configuration.'
  }
  return raw
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  // ── Guard: require service role key to be injected ────────────────────────
  const serviceRoleKey = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')
  const supabaseUrl    = Deno.env.get('SUPABASE_URL')
  const anonKey        = Deno.env.get('SUPABASE_ANON_KEY')

  if (!serviceRoleKey || !supabaseUrl || !anonKey) {
    console.error('admin-users: missing required env vars')
    return err('Server misconfiguration: missing environment variables', 500)
  }

  try {
    // ── 1. Verify caller is authenticated ──────────────────────────────────
    const authHeader = req.headers.get('Authorization')
    if (!authHeader) return err('Missing authorization header', 401)

    const caller = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: authHeader } },
    })
    const { data: { user }, error: authErr } = await caller.auth.getUser()
    if (authErr || !user) return err('Unauthorized', 401)

    // ── 2. Verify caller is super_admin ────────────────────────────────────
    const { data: roleRow } = await caller
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single()

    if (roleRow?.role !== 'super_admin') return err('Forbidden: super_admin role required', 403)

    // ── 3. Admin client — uses service role key, server-side only ──────────
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const body   = await req.json()
    const action = body?.action

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

      // Invite flow: creates user + sends activation email via service role.
      // Frontend NEVER calls Supabase admin APIs directly — this is the only
      // place inviteUserByEmail() runs, and it's guarded by super_admin check above.
      case 'createUser': {
        const { email, full_name, role } = body
        if (!email) return err('Email is required', 400)
        if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return err('Invalid email address', 400)

        const { data, error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
          data: { full_name: full_name ?? '' },
          redirectTo: DEFAULT_REDIRECT,
        })

        if (inviteErr) {
          const friendly = friendlyInviteError(inviteErr.message ?? '')
          const status   = inviteErr.message?.toLowerCase().includes('already') ? 409 : 422
          return err(friendly, status)
        }

        await admin.from('user_roles').upsert({
          user_id:   data.user.id,
          email:     data.user.email,
          full_name: full_name ?? '',
          role:      role ?? 'viewer',
        })

        return json({ user: data.user })
      }

      // Resend invite to an unconfirmed user
      case 'resendInvite': {
        const { email } = body
        if (!email) return err('Email is required', 400)

        const { error: inviteErr } = await admin.auth.admin.inviteUserByEmail(email, {
          redirectTo: DEFAULT_REDIRECT,
        })
        if (inviteErr) {
          return err(friendlyInviteError(inviteErr.message ?? ''), 422)
        }
        return json({ success: true })
      }

      case 'updateUser': {
        const { userId, full_name, role } = body
        if (!userId) return err('userId is required', 400)

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
        if (!userId)            return err('userId is required', 400)
        if (userId === user.id) return err('You cannot disable your own account', 400)

        const { error: banErr } = await admin.auth.admin.updateUserById(userId, {
          ban_duration: '876000h',
        })
        if (banErr) throw banErr
        return json({ success: true })
      }

      case 'enableUser': {
        const { userId } = body
        if (!userId) return err('userId is required', 400)

        const { error: unbanErr } = await admin.auth.admin.updateUserById(userId, {
          ban_duration: 'none',
        })
        if (unbanErr) throw unbanErr
        return json({ success: true })
      }

      case 'deleteUser': {
        const { userId } = body
        if (!userId)            return err('userId is required', 400)
        if (userId === user.id) return err('You cannot delete your own account', 400)

        await admin.from('user_roles').delete().eq('user_id', userId)
        const { error: delErr } = await admin.auth.admin.deleteUser(userId)
        if (delErr) throw delErr
        return json({ success: true })
      }

      case 'resetPassword': {
        const { email } = body
        if (!email) return err('Email is required', 400)

        const { data: linkData, error: linkErr } = await admin.auth.admin.generateLink({
          type:  'recovery',
          email,
          options: { redirectTo: DEFAULT_REDIRECT },
        })
        if (linkErr) throw linkErr
        return json({ link: (linkData as any)?.properties?.action_link ?? null })
      }

      default:
        return err(`Unknown action: ${action ?? '(none)'}`, 400)
    }

  } catch (e: any) {
    console.error('admin-users error:', e)
    const msg    = e?.message ?? 'Internal server error'
    const status = /forbidden/i.test(msg) ? 403
                 : /unauthorized/i.test(msg) ? 401
                 : 500
    return err(msg, status)
  }
})
