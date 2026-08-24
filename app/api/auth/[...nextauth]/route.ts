import NextAuth from 'next-auth'
import CredentialsProvider from 'next-auth/providers/credentials'

const handler = NextAuth({
  providers: [
    CredentialsProvider({
      name: 'Password',
      credentials: {
        password: { label: 'Password', type: 'password' }
      },
      async authorize(credentials) {
        if (credentials?.password === process.env.FSE_PASSWORD) {
          return { id: '1', name: 'FSE Engineer' }
        }
        return null
      }
    })
  ],
  pages: {
    signIn: '/login'
  },
  session: {
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60
  },
  secret: process.env.NEXTAUTH_SECRET
})

export { handler as GET, handler as POST }
