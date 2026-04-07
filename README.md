💼 LoanLink Server

LoanLink Server is a scalable and secure backend system built to power a modern loan management platform. It provides RESTful APIs for user authentication, loan processing, approval workflows, and secure financial data handling.

🚀 Features
🔐 JWT-based secure authentication
👤 Role-based access control (Admin / User)
💰 Loan application and tracking system
📊 Loan approval and status management
🗂️ Full CRUD operations for users and loans
🛡️ Protected routes with middleware
🔑 Service Key Encoder for secure third-party integration
⚡ Clean and modular RESTful API architecture
🔑 Service Key Encoder

LoanLink includes a utility to securely encode service account keys (e.g., Firebase Admin SDK credentials) into Base64 format for safer environment variable usage.

✨ Why this matters
Avoids exposing raw JSON credential files
Makes deployment easier (especially on platforms like Render)
Keeps sensitive keys inside .env instead of files
🛠️ Implementation
const fs = require('fs')

const jsonData = fs.readFileSync('./serviceAccountKey.json')
const base64String = Buffer.from(jsonData, 'utf-8').toString('base64')

console.log(base64String)
⚙️ How to use
Run the script:
node serviceKeyConverter.js
Copy the generated Base64 string
Store it in your .env file:
FB_SERVICE_KEY=your_base64_encoded_key
Decode it inside your server when needed
🛠️ Tech Stack
Backend: Node.js, Express.js
Database: MongoDB (Mongoose)
Authentication: JSON Web Token (JWT)
Environment: dotenv
Version Control: Git & GitHub
📁 Project Structure
LoanLink-Server/
│── vercel.json
│── serviceKeyConverter.js
│── index.js
│── .env
⚙️ Installation & Setup
1️⃣ Clone the repository
git clone https://github.com/SwarnaliSahaBristi/loan-server-site.git
cd loanlink-server
2️⃣ Install dependencies
npm install
3️⃣ Configure environment variables

Create a .env file in the root directory:

CLIENT_DOMAIN=your_client_domain
MONGODB_URI=your_mongodb_connection_string
STRIPE_SECRET_KEY=your_secret_key
FB_SERVICE_KEY=your_base64_encoded_service_key
4️⃣ Run the server
npm run dev

Server will run on:
👉 http://localhost:5000

📡 API Endpoints
🔑 Authentication
POST /api/auth/register
POST /api/auth/login
👤 Users
GET /api/users
GET /api/users/:id
💼 Loans
POST /api/loans/apply
GET /api/loans
PATCH /api/loans/:id/status
🔐 Authentication
Uses JWT (JSON Web Tokens)
Protected routes require token in headers:
Authorization: Bearer <your_token>
🧪 Testing

You can test API endpoints using:

Postman
Thunder Client (VS Code Extension)
🌐 Deployment

Supported platforms:

Render
Railway
Vercel (Serverless functions)
🤝 Contribution

Contributions are welcome!
Feel free to fork the repository and submit a pull request.

📄 License

This project is licensed under the MIT License.

👩‍💻 Author

Swarnali Saha Bristi
💼 Aspiring Full Stack Developer
🌱 Interested in Tech, AI & Backend Systems

⭐ Support

If you found this project helpful, consider giving it a ⭐ on GitHub!