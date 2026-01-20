# Frontend Boilerplate

This project is built using Vite with React and Material UI. It provides a solid foundation for a scalable web application with a professional structure.

## Project Structure

```
frontend/
├── package.json          # Node.js project manifest with dependencies and scripts for Vite, React, and Material UI.
├── vite.config.js        # Vite configuration file.
├── .eslintrc.json        # ESLint configuration.
├── src/                  # Source code directory.
│   ├── main.jsx          # Main entry point with React Router setup.
│   ├── App.jsx           # Root App component with routing configuration.
│   ├── index.css         # Global CSS.
│   ├── theme.js          # Material UI theme customization.
│   ├── contexts/         # React contexts for state management.
│   │   ├── ThemeContext.js # Theme context for managing application theme settings.
│   │   └── AuthContext.js  # Authentication context for managing user session.
│   ├── components/       # Directory for reusable React components.
│   │   ├── Header.js     # Header component with theme indicator and navigation.
│   │   └── FormField.js  # Reusable form field component.
│   ├── pages/            # Application pages.
│   │   ├── Home.jsx      # Homepage.
│   │   ├── Login.jsx     # Login page.
│   │   ├── Register.jsx  # Registration page.
│   │   └── Settings.jsx  # Settings page with theme mode configuration.
│   ├── api/              # API client modules.
│   └── data/             # Data files for the application.
├── public/               # Static assets like images, fonts, etc.
└── README.md             # This README file.
```

## Common Components

The project includes a set of common reusable components located in the folder `src/components/`. These components are designed to promote consistency and reusability across the application:

- **Header**: A modern, minimal header component that is rendered on all pages.
- **FormField**: A reusable form field component for standardized form inputs.

## Features

- **Authentication**: Complete authentication system with login, registration, and session management.
- **Theme Switching**: The application supports light, dark, and system themes. Users can change the theme from the settings page.
- **Responsive Design**: Built with Material UI components for a responsive and mobile-friendly interface.
- **Theme Persistence**: User's theme preference is saved to localStorage and persists between sessions.
- **CSRF Protection**: Proper CSRF token handling for secure form submissions.
- **Google OAuth**: Integration with Google authentication (requires setup).

## Authentication

The frontend integrates with the Django backend's session-based authentication system.

*   **State Management:**
    *   `src/contexts/AuthContext.js`: Uses React Context API to manage global authentication state (`user`, `isAuthenticated`, `isLoading`).
    *   Provides functions (`login`, `register`, `logout`, `loadUser`) that interact with the backend API endpoints.
    *   The application is wrapped with `AuthProvider` in `src/App.jsx`.
*   **API Client (`axios`):**
    *   An `axios` instance (`apiClient` in `AuthContext.js`) is configured with:
        *   `baseURL` pointing to the backend (e.g., `http://localhost:8000`).
        *   `withCredentials: true` to automatically send/receive cookies.
        *   Automatic CSRF protection enabled via `xsrfCookieName: 'csrftoken'`, `xsrfHeaderName: 'X-CSRFToken'`, and `withXSRFToken: true` to handle Django's CSRF requirements for POST/PUT/DELETE requests.
*   **UI Components:**
    *   `src/components/Header.js`: Conditionally renders Login/Register links or User Info/Logout button based on `isAuthenticated` state from `AuthContext`.
    *   `src/pages/Login.jsx`: Provides the login form, calls the `login` function from `AuthContext`.
    *   `src/pages/Register.jsx`: Provides the registration form, calls the `register` function from `AuthContext`.

## Getting Started

1. Install dependencies:
   ```bash
   npm install
   ```

2. Configure API endpoint:
   Create a `.env.local` file in the project root with the following content:
   ```
   VITE_API_BASE_URL=http://your-api-server-url
   ```
   By default, it tries to connect to `http://localhost:8000` if no value is provided.

3. Run the development server:
   ```bash
   npm run dev
   ```

4. Open [http://localhost:3000](http://localhost:3000) in your browser to view the application.

## Available Scripts

- `npm run dev`   - Runs the application in development mode.
- `npm run build` - Builds the application for production.
- `npm run preview` - Previews the production build locally.
- `npm run lint`  - Lints the codebase using ESLint.