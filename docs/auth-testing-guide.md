## Хэрэгтэй утгууд

```
SUPABASE_URL   = https://faktpbhepfrftyckgotn.supabase.co
ANON_KEY       = eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZha3RwYmhlcGZyZnR5Y2tnb3RuIiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODQ2NjUwNTUsImV4cCI6MjEwMDI0MTA1NX0.HNgd0S4KIAlunSOvrHhl2GYjg5qDhAEtxnC9prSYlUk
```

⚠️ `service_role` key үүнд хэрэггүй, зөвхөн backend-ийн `.env`-д байна, хэнд ч бүү дамжуул.

---

## 1. Бүртгүүлэх (signUp)

```http
POST {{SUPABASE_URL}}/auth/v1/signup
apikey: {{ANON_KEY}}
Content-Type: application/json

{
  "email": "test3@example.com",
  "password": "Password123!"
}
```

## 2. Нэвтрэх (signInWithPassword)

```http
POST {{SUPABASE_URL}}/auth/v1/token?grant_type=password
apikey: {{ANON_KEY}}
Content-Type: application/json

{
  "email": "test2@example.com",
  "password": "Password123!"
}
```

## 3. Гарах (signOut)

```http
POST {{SUPABASE_URL}}/auth/v1/logout
apikey: {{ANON_KEY}}
Authorization: Bearer <access_token>
```

**Хүлээгдэж буй хариу:** хоосон (204) — тухайн session хүчингүй болно.

---
