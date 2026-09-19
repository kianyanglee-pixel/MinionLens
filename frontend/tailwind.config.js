/** @type {import('tailwindcss').Config} */
export default {
    content: [
        "./index.html",
        "./src/**/*.{vue,js,ts,jsx,tsx}"
    ],
    darkMode: 'class',
    theme: {
        extend: {
            fontFamily: {
                sans: ['"Plus Jakarta Sans"', 'system-ui', '-apple-system', 'sans-serif'],
                mono: ['"JetBrains Mono"', 'monospace'],
            },
            colors: {
                maritime: {
                    950: '#060A12',
                    900: '#0B1120',
                    850: '#10192D',
                    800: '#17233B',
                    700: '#1F2F4E',
                    600: '#2C446F',
                    cyan: '#00F0FF',
                    blue: '#3B82F6',
                    emerald: '#10B981',
                    rose: '#F43F5E',
                    amber: '#F59E0B',
                }
            },
            backgroundImage: {
                'ocean-gradient': 'radial-gradient(circle at 50% 0%, rgba(14, 165, 233, 0.15) 0%, rgba(6, 10, 18, 0) 70%)',
                'glow-cyan': 'radial-gradient(circle, rgba(0, 240, 255, 0.15) 0%, rgba(0,0,0,0) 70%)',
                'glow-rose': 'radial-gradient(circle, rgba(244, 63, 94, 0.15) 0%, rgba(0,0,0,0) 70%)',
            }
        },
    },
    plugins: [],
}