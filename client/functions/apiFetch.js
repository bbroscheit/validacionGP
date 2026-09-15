// Wrapper de fetch para pegarle a la API propia: agrega credentials:"include" para que
// el navegador mande la cookie de sesión (login contra Active Directory) - el front y la
// API corren en puertos distintos, así que sin esto la cookie no viaja y el backend
// devuelve 401 en todo.
export function apiFetch(input, init = {}) {
  return fetch(input, { ...init, credentials: "include" });
}
