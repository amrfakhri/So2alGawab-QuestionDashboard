import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
}

// Must match a URL in Supabase Auth → URL Configuration → Redirect URLs
const DEFAULT_REDIRECT = 'https://gamedata.amrfakhri.com/auth/callback'
const APP_URL          = 'https://gamedata.amrfakhri.com'

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

function friendlyInviteError(raw: string): string {
  const msg = raw.toLowerCase()
  if (msg.includes('already registered') || msg.includes('already been invited') || msg.includes('user already exists')) {
    return 'A user with this email already exists. If they haven\'t activated yet, use "Resend Invite".'
  }
  if (msg.includes('rate limit') || msg.includes('too many requests') || msg.includes('email rate limit')) {
    return 'Too many invite emails sent recently. Please wait a few minutes before trying again.'
  }
  if (msg.includes('invalid email') || msg.includes('unable to validate email')) {
    return 'The email address is invalid or cannot receive emails.'
  }
  if (msg.includes('redirect') || msg.includes('not allowed')) {
    return 'Invite failed: the redirect URL is not in the Supabase allowed list. Add it in Auth → URL Configuration.'
  }
  return raw
}

async function sendResendEmail(opts: {
  apiKey: string
  from:   string
  to:     string
  subject: string
  html:   string
}) {
  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${opts.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: opts.from, to: [opts.to], subject: opts.subject, html: opts.html }),
  })
  if (!res.ok) {
    const body = await res.text()
    console.error('Resend error:', res.status, body)
  }
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })

  // ── Guard: validate required environment variables ────────────────────────
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

    // ── 2. Get caller's role ───────────────────────────────────────────────
    const { data: roleRow } = await caller
      .from('user_roles')
      .select('role')
      .eq('user_id', user.id)
      .single()

    // ── 3. Admin client — service role, server-side only ──────────────────
    const admin = createClient(supabaseUrl, serviceRoleKey, {
      auth: { autoRefreshToken: false, persistSession: false },
    })

    const body   = await req.json()
    const action = body?.action

    // ── 4. userActivated: callable by ANY authenticated user ───────────────
    //    Triggered from index.html after a new user sets their password.
    //    Sends approval request emails to all super_admins.
    if (action === 'userActivated') {
      // Only fire for pending users (freshly activated invitees)
      const { data: callerInfo } = await admin
        .from('user_roles')
        .select('role, full_name, email, pending_role')
        .eq('user_id', user.id)
        .single()

      if (callerInfo?.role !== 'pending') {
        return json({ success: true }) // not pending — nothing to do
      }

      // Get all super_admin emails to notify
      const { data: superAdmins } = await admin
        .from('user_roles')
        .select('email, full_name')
        .eq('role', 'super_admin')

      if (!superAdmins?.length) return json({ success: true })

      const resendApiKey    = Deno.env.get('RESEND_API_KEY')
      const notifyFromEmail = Deno.env.get('NOTIFY_FROM_EMAIL') ?? `noreply@${new URL(APP_URL).hostname}`

      if (!resendApiKey) {
        console.warn('admin-users: RESEND_API_KEY not set — skipping approval email')
        return json({ success: true })
      }

      const userName    = callerInfo.full_name?.trim() || user.email
      const pendingRole = callerInfo.pending_role ?? 'viewer'
      const usersUrl    = `${APP_URL}/users.html`

      for (const sa of superAdmins) {
        if (!sa.email) continue
        await sendResendEmail({
          apiKey:  resendApiKey,
          from:    `So2alGawab <${notifyFromEmail}>`,
          to:      sa.email,
          subject: `Action required: ${userName} is awaiting approval`,
          html: `
            <div style="font-family:sans-serif;max-width:540px;margin:0 auto;padding:24px;">
              <h2 style="color:#1e293b;margin-bottom:8px;">New user awaiting approval</h2>
              <p style="color:#475569;">
                <strong>${userName}</strong> (${user.email}) has activated their account
                and is waiting for your approval before they can access So2alGawab.
              </p>
              <table style="width:100%;border-collapse:collapse;margin:20px 0;">
                <tr>
                  <td style="padding:8px 12px;background:#f8fafc;color:#64748b;border-radius:6px 0 0 6px;width:40%;">Requested role</td>
                  <td style="padding:8px 12px;background:#f8fafc;font-weight:600;color:#0f172a;border-radius:0 6px 6px 0;">${pendingRole.replace('_', ' ')}</td>
                </tr>
              </table>
              <a href="${usersUrl}"
                 style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:8px;">
                Review &amp; Approve →
              </a>
              <p style="color:#94a3b8;font-size:12px;margin-top:24px;">
                You received this because you are a Super Admin on So2alGawab.
              </p>
            </div>
          `,
        })
      }

      return json({ success: true })
    }

    // ── 5. All other actions require super_admin ───────────────────────────
    if (roleRow?.role !== 'super_admin') return err('Forbidden: super_admin role required', 403)

    // ── 6. Dispatch ────────────────────────────────────────────────────────
    switch (action) {

      case 'listUsers': {
        const { data: authData, error: listErr } = await admin.auth.admin.listUsers({ perPage: 1000 })
        if (listErr) throw listErr

        const { data: roles } = await admin.from('user_roles').select('*')
        const roleMap: Record<string, any> = {}
        ;(roles || []).forEach((r: any) => { roleMap[r.user_id] = r })

        const users = authData.users.map((u: any) => ({
          id:              u.id,
          email:           u.email ?? '',
          full_name:       roleMap[u.id]?.full_name ?? u.user_metadata?.full_name ?? '',
          role:            roleMap[u.id]?.role ?? 'pending',
          pending_role:    roleMap[u.id]?.pending_role ?? null,
          created_at:      u.created_at,
          last_sign_in_at: u.last_sign_in_at ?? null,
          last_seen_at:    roleMap[u.id]?.last_seen_at ?? null,
          disabled:        u.banned_until ? new Date(u.banned_until) > new Date() : false,
          confirmed:       !!u.confirmed_at,
        }))

        return json({ users })
      }

      // Invite flow: new user starts as 'pending'; pending_role stores the
      // intended role that super_admin will promote to upon approval.
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
          user_id:      data.user.id,
          email:        data.user.email,
          full_name:    full_name ?? '',
          role:         'pending',          // blocked until super_admin approves
          pending_role: role ?? 'viewer',   // role granted on approval
        })

        return json({ user: data.user })
      }

      // Promote a pending user to their intended role.
      case 'approveUser': {
        const { userId, role: bodyRole } = body
        if (!userId) return err('userId is required', 400)

        // Try full query (with pending_role). If it fails (column missing in older DBs),
        // fall back to a query without it and rely on bodyRole sent from the UI.
        let target: any = null
        const { data: fullTarget, error: fetchErr } = await admin
          .from('user_roles')
          .select('role, pending_role, email, full_name')
          .eq('user_id', userId)
          .single()

        if (fetchErr) {
          const { data: basicTarget, error: basicErr } = await admin
            .from('user_roles')
            .select('role, email, full_name')
            .eq('user_id', userId)
            .single()
          if (basicErr || !basicTarget) return err('User not found', 404)
          target = basicTarget
        } else {
          if (!fullTarget) return err('User not found', 404)
          target = fullTarget
        }

        if (target.role !== 'pending') return err('User is not in pending state', 400)

        const grantRole = target.pending_role ?? bodyRole
        if (!grantRole) return err('No intended role set for this user', 400)

        await admin
          .from('user_roles')
          .update({ role: grantRole, pending_role: null })
          .eq('user_id', userId)

        // Optionally send approval notification email to the user
        const resendApiKey    = Deno.env.get('RESEND_API_KEY')
        const notifyFromEmail = Deno.env.get('NOTIFY_FROM_EMAIL') ?? `noreply@${new URL(APP_URL).hostname}`

        if (resendApiKey && target.email) {
          const userName = target.full_name?.trim() || target.email
          await sendResendEmail({
            apiKey:  resendApiKey,
            from:    `So2alGawab <${notifyFromEmail}>`,
            to:      target.email,
            subject: 'Your So2alGawab account has been approved',
            html: `
              <div style="font-family:sans-serif;max-width:540px;margin:0 auto;padding:24px;">
                <h2 style="color:#1e293b;margin-bottom:8px;">You're approved!</h2>
                <p style="color:#475569;">
                  Hi ${userName},<br><br>
                  Your So2alGawab account has been approved. You can now sign in and access the dashboard.
                </p>
                <a href="${APP_URL}"
                   style="display:inline-block;background:#2563eb;color:#fff;padding:12px 24px;border-radius:8px;text-decoration:none;font-weight:600;margin-top:8px;">
                  Go to Dashboard →
                </a>
              </div>
            `,
          })
        }

        return json({ success: true, role: grantRole })
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
          type:    'recovery',
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
