import { BrowserRouter, Routes, Route } from "react-router-dom";
import { createRoot } from "react-dom/client";
import "./css/app.css";

function Home() {
  return <h1>MyApp</h1>;
}

const root = createRoot(document.getElementById("app")!);

root.render(
  <BrowserRouter>
    <Routes>
      <Route path="/" element={<Home />} />
    </Routes>
  </BrowserRouter>,
);
