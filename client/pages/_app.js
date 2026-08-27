import "@/styles/globals.css";
import Nav from "@/components/Nav";

export default function App({ Component, pageProps }) {
  return (
    <>
      <Nav />
      <main className="max-w-5xl mx-auto px-4 py-6">
        <Component {...pageProps} />
      </main>
    </>
  );
}
